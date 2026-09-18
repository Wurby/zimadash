import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { dataFile, personal, readJson, writeJson } from '../../paths.js';
import { currentUser, runAs } from '../../context.js';
import type { QueuedMeal, QueueSource } from '../../shared/calories.js';
import { complete, estimateMeal, serialise, writePhotoJob } from './brain.js';
import { trackedFields } from './settings.js';
import { addEntry, dayKeyFor, entriesForDay, updateEntry } from './storage.js';
import type { Entry } from '../../shared/calories.js';

/**
 * In-flight captures. Photo and text land here; Grok fills them in off the
 * request, then they are written to the log. A number or an Again chip skips
 * this and logs immediately.
 *
 * Same bargain as the inbox: bytes (or the typed meal) hit DATA_DIR before a
 * 202 goes back, so locking the phone cannot lose the capture. The HTTP
 * request never waits on the brain — the tunnel's ~100s cap sits on the
 * upload, not on Grok.
 *
 * Watchdog is 30 minutes, Grok's own default wait for an answer. Until then
 * the item stays working. Only a real brain failure (auth, crash, unparseable
 * reply, or that watchdog) becomes an empty slot.
 */

function queueFile(): string {
  return personal('calories/queue.json');
}

function incomingDir(): string {
  return personal('calories/incoming');
}

/** Grok's own [toolset.ask_user_question] timeout_secs default. */
const WATCHDOG_MS = 1_800_000;

const queues = new Map<string, QueuedMeal[]>();
const adjustJobs = new Map<string, number>();
const lastAdjustError = new Map<string, string | null>();

function itemsOf(): QueuedMeal[] {
  const id = currentUser().id;
  if (!queues.has(id)) {
    queues.set(id, readJson<QueuedMeal[]>(queueFile()) ?? []);
  }
  return queues.get(id)!;
}

function setItems(next: QueuedMeal[]): void {
  queues.set(currentUser().id, next);
  persist();
}

function persist(): void {
  writeJson(queueFile(), itemsOf());
}

function photoPath(id: string): string {
  return dataFile(path.join(incomingDir(), `${id}.json`));
}

export function allItems(): QueuedMeal[] {
  return itemsOf();
}

export function itemsForDay(day: string): QueuedMeal[] {
  return itemsOf()
    .filter((item) => item.day === day)
    .sort((a, b) => a.at - b.at);
}

export function isAdjusting(): boolean {
  return (adjustJobs.get(currentUser().id) ?? 0) > 0;
}

export function adjustError(): string | null {
  return lastAdjustError.get(currentUser().id) ?? null;
}

/** Fire-and-forget. New captures can join the pile while this runs. */
export function queueAdjust(day: string, feedback: string): { error?: string } {
  if (entriesForDay(day).length === 0) return { error: 'nothing to adjust yet' };
  const user = currentUser();
  lastAdjustError.set(user.id, null);
  adjustJobs.set(user.id, (adjustJobs.get(user.id) ?? 0) + 1);
  void runAs(user, () =>
    adjustDay(day, feedback)
      .then((result) => {
        if (result.error) lastAdjustError.set(user.id, result.error);
      })
      .finally(() => {
        adjustJobs.set(user.id, Math.max(0, (adjustJobs.get(user.id) ?? 1) - 1));
      }),
  );
  return {};
}

function enqueue(
  source: QueueSource,
  description: string,
  values: Record<string, number>,
  status: QueuedMeal['status'],
): QueuedMeal {
  const today = dayKeyFor(Date.now());
  const item: QueuedMeal = {
    id: randomUUID(),
    day: today,
    at: Date.now(),
    source,
    status,
    description,
    values,
    assumptions: '',
    reason: null,
  };
  setItems([...itemsOf(), item]);
  return item;
}

function spawn(id: string): void {
  const user = currentUser();
  void runAs(user, () => processItem(id));
}

export function queueDirect(description: string, values: Record<string, number>): Entry {
  return addEntry({ at: Date.now(), description, values });
}

export function queueText(description: string): QueuedMeal {
  const item = enqueue('text', description, {}, 'working');
  spawn(item.id);
  return item;
}

export function queuePhoto(base64: string): QueuedMeal {
  const item = enqueue('photo', 'photograph', {}, 'working');
  writePhotoJob(base64, photoPath(item.id), ['Meal: the photograph.']);
  spawn(item.id);
  return item;
}

export function dropItem(id: string): boolean {
  const item = itemsOf().find((candidate) => candidate.id === id);
  if (!item || item.status === 'working') return false;
  setItems(itemsOf().filter((candidate) => candidate.id !== id));
  fs.rmSync(photoPath(id), { force: true });
  return true;
}

export function fillItem(id: string, description?: string, base64?: string): QueuedMeal | null {
  const item = itemsOf().find((candidate) => candidate.id === id);
  if (!item || item.status === 'working') return null;

  if (base64) {
    item.source = 'photo';
    item.description = 'photograph';
    item.values = {};
    item.assumptions = '';
    item.reason = null;
    item.status = 'working';
    writePhotoJob(base64, photoPath(id), ['Meal: the photograph.']);
  } else if (description && description.trim()) {
    item.source = 'text';
    item.description = description.trim();
    item.values = {};
    item.assumptions = '';
    item.reason = null;
    item.status = 'working';
    fs.rmSync(photoPath(id), { force: true });
  } else {
    return null;
  }

  persist();
  spawn(id);
  return item;
}

function commitItem(item: QueuedMeal): void {
  addEntry({
    at: item.at,
    description: item.description,
    values: item.values,
    assumptions: item.assumptions || undefined,
  });
  fs.rmSync(photoPath(item.id), { force: true });
  setItems(itemsOf().filter((candidate) => candidate.id !== item.id));
}

async function processItem(id: string): Promise<void> {
  const item = itemsOf().find((candidate) => candidate.id === id);
  if (!item || item.status !== 'working') return;

  try {
    if (item.source === 'direct') {
      commitItem(item);
      return;
    }

    const promptFile = item.source === 'photo' ? photoPath(id) : undefined;
    const transcript =
      item.source === 'photo' ? ['Meal: the photograph.'] : [`Meal: ${item.description}`];
    const parsed = await estimateMeal(transcript, promptFile, WATCHDOG_MS);

    const current = itemsOf().find((candidate) => candidate.id === id);
    if (!current) return;
    current.description = parsed.name || current.description;
    current.values = parsed.values;
    current.assumptions = parsed.assumptions;
    current.reason = null;
    commitItem(current);
  } catch (err) {
    const current = itemsOf().find((candidate) => candidate.id === id);
    if (!current) return;
    current.status = 'empty';
    current.values = {};
    current.reason = err instanceof Error ? err.message : 'the estimator failed';
    persist();
  }
}

export async function adjustDay(day: string, feedback: string): Promise<{ error?: string }> {
  const dayItems = entriesForDay(day);
  if (dayItems.length === 0) return { error: 'nothing to adjust yet' };

  const fields = trackedFields();
  const fieldIds = fields.map((field) => field.id);
  const known = new Set(dayItems.map((item) => item.id));
  const listed = dayItems
    .map((item) => {
      const nums = fieldIds
        .map((id) => (item.values[id] !== undefined ? `    "${id}": ${item.values[id]}` : null))
        .filter(Boolean)
        .join(',\n');
      return `- id ${item.id}\n  name: ${item.description}\n  values:\n${nums}${
        item.assumptions ? `\n  assumptions: ${item.assumptions}` : ''
      }`;
    })
    .join('\n');

  const prompt = `You adjust logged meals for one day of a calorie log.

The person said: "${feedback}"

These are the meals:

${listed}

Apply that correction to whichever meal(s) it refers to. Do not invent a new
meal. Do not drop a meal (they have a separate control for that).

Reply with a single JSON object and nothing else — no prose, no code fence:

{
  "changes": [
    {
      "id": "<id from the list>",
      "description": "<optional new name>",
      "values": { ${fieldIds.map((id) => `"${id}": <number>`).join(', ')} },
      "assumptions": "<optional one sentence>"
    }
  ]
}

Every id must be one of the meals above. Every key under values is required
and must be a plain number.`;

  let reply: string;
  try {
    reply = await serialise(() => complete(prompt, '', WATCHDOG_MS));
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'the adjustment failed' };
  }

  const match = reply.match(/\{[\s\S]*\}/);
  if (!match) return { error: "the adjustment's reply could not be read" };

  let body: { changes?: unknown };
  try {
    body = JSON.parse(match[0]) as { changes?: unknown };
  } catch {
    return { error: "the adjustment's reply could not be read" };
  }

  if (!Array.isArray(body.changes) || body.changes.length === 0) {
    return { error: 'nothing was changed' };
  }

  for (const raw of body.changes as Record<string, unknown>[]) {
    const id = typeof raw.id === 'string' ? raw.id : '';
    if (!known.has(id)) continue;

    const patch: { description?: string; assumptions?: string; values?: Record<string, number> } =
      {};
    if (typeof raw.description === 'string' && raw.description.trim()) {
      patch.description = raw.description.trim().slice(0, 80);
    }
    if (typeof raw.assumptions === 'string') {
      patch.assumptions = raw.assumptions.trim();
    }
    const incoming = raw.values as Record<string, unknown> | undefined;
    if (incoming && typeof incoming === 'object') {
      const values: Record<string, number> = {};
      let ok = true;
      for (const fieldId of fieldIds) {
        const rawValue = incoming[fieldId];
        const value = typeof rawValue === 'string' ? Number(rawValue) : rawValue;
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          ok = false;
          break;
        }
        values[fieldId] = Math.round(value * 10) / 10;
      }
      if (ok) patch.values = values;
    }
    if (patch.values || patch.description !== undefined || patch.assumptions !== undefined) {
      updateEntry(id, patch);
    }
  }

  return {};
}

/** Resume anything still working after a restart — the bytes are on disk.
 *  Leftover `ready` items from the old review pile are written to the log. */
export function resumeWorking(): void {
  for (const item of [...itemsOf()]) {
    if (item.status === 'ready') commitItem(item);
    else if (item.status === 'working') spawn(item.id);
  }
}
