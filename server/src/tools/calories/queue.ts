import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { dataFile, readJson, writeJson } from '../../paths.js';
import type { QueuedMeal, QueueSource } from '../../shared/calories.js';
import { complete, estimateMeal, serialise, writePhotoJob } from './brain.js';
import { trackedFields } from './settings.js';
import { addEntry, dayKeyFor } from './storage.js';

/**
 * The review pile. Captures land here and Grok fills them in off the request.
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

const FILE = 'calories/queue.json';
const INCOMING = 'calories/incoming';
/** Grok's own [toolset.ask_user_question] timeout_secs default. */
const WATCHDOG_MS = 1_800_000;

let items: QueuedMeal[] = readJson<QueuedMeal[]>(FILE) ?? [];

function persist(): void {
  writeJson(FILE, items);
}

function photoPath(id: string): string {
  return dataFile(path.join(INCOMING, `${id}.json`));
}

function totalsOf(meals: QueuedMeal[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const meal of meals) {
    if (meal.status !== 'ready') continue;
    for (const [field, value] of Object.entries(meal.values)) {
      totals[field] = Math.round(((totals[field] ?? 0) + value) * 10) / 10;
    }
  }
  return totals;
}

export function allItems(): QueuedMeal[] {
  return items;
}

export function itemsForDay(day: string): QueuedMeal[] {
  return items.filter((item) => item.day === day).sort((a, b) => a.at - b.at);
}

export function pendingTotalsFor(day: string): Record<string, number> {
  return totalsOf(itemsForDay(day));
}

/** Oldest day that still has queue items. Null if the pile is empty. */
export function oldestQueuedDay(): string | null {
  const days = [...new Set(items.map((item) => item.day))].sort();
  return days[0] ?? null;
}

/**
 * Calendar today if the pile is empty or only today has items; otherwise the
 * oldest unreviewed day — that's the review the Today tab is forced onto.
 */
export function reviewDay(today: string): string {
  const oldest = oldestQueuedDay();
  if (oldest && oldest < today) return oldest;
  return today;
}

export function loggingSuspended(today: string): boolean {
  const oldest = oldestQueuedDay();
  return oldest !== null && oldest < today;
}

let adjustJobs = 0;
let lastAdjustError: string | null = null;

export function isAdjusting(): boolean {
  return adjustJobs > 0;
}

export function adjustError(): string | null {
  return lastAdjustError;
}

/** Fire-and-forget. New captures can join the pile while this runs. */
export function queueAdjust(day: string, feedback: string): { error?: string } {
  const ready = itemsForDay(day).filter((item) => item.status === 'ready');
  if (ready.length === 0) return { error: 'nothing to adjust yet' };
  lastAdjustError = null;
  adjustJobs += 1;
  void adjustDay(day, feedback)
    .then((result) => {
      if (result.error) lastAdjustError = result.error;
    })
    .finally(() => {
      adjustJobs -= 1;
    });
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
    // Land on the day under review, not always calendar today — so a photo
    // taken while yesterday is still open joins yesterday's pile.
    day: reviewDay(today),
    at: Date.now(),
    source,
    status,
    description,
    values,
    assumptions: '',
    reason: null,
  };
  items = [...items, item];
  persist();
  return item;
}

export function queueDirect(description: string, values: Record<string, number>): QueuedMeal {
  return enqueue('direct', description, values, 'ready');
}

export function queueText(description: string): QueuedMeal {
  const item = enqueue('text', description, {}, 'working');
  void processItem(item.id);
  return item;
}

export function queuePhoto(base64: string): QueuedMeal {
  const item = enqueue('photo', 'photograph', {}, 'working');
  writePhotoJob(base64, photoPath(item.id), ['Meal: the photograph.']);
  void processItem(item.id);
  return item;
}

export function dropItem(id: string): boolean {
  const item = items.find((candidate) => candidate.id === id);
  if (!item || item.status === 'working') return false;
  items = items.filter((candidate) => candidate.id !== id);
  fs.rmSync(photoPath(id), { force: true });
  persist();
  return true;
}

export function fillItem(id: string, description?: string, base64?: string): QueuedMeal | null {
  const item = items.find((candidate) => candidate.id === id);
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
  void processItem(id);
  return item;
}

export function approveDay(day: string): { ok: true } | { error: string } {
  if (adjustJobs > 0) return { error: 'an adjustment is still running' };
  const dayItems = itemsForDay(day);
  if (dayItems.length === 0) return { error: 'nothing to approve' };
  if (dayItems.some((item) => item.status !== 'ready')) {
    return { error: 'every item needs numbers before the day can be approved' };
  }

  for (const item of dayItems) {
    addEntry({
      at: item.at,
      description: item.description,
      values: item.values,
      assumptions: item.assumptions || undefined,
    });
    fs.rmSync(photoPath(item.id), { force: true });
  }
  items = items.filter((item) => item.day !== day);
  persist();
  return { ok: true };
}

async function processItem(id: string): Promise<void> {
  const item = items.find((candidate) => candidate.id === id);
  if (!item || item.status !== 'working') return;

  try {
    if (item.source === 'direct') {
      item.status = 'ready';
      persist();
      return;
    }

    const promptFile = item.source === 'photo' ? photoPath(id) : undefined;
    const transcript =
      item.source === 'photo' ? ['Meal: the photograph.'] : [`Meal: ${item.description}`];
    const parsed = await estimateMeal(transcript, promptFile, WATCHDOG_MS);

    const current = items.find((candidate) => candidate.id === id);
    if (!current) return;
    current.status = 'ready';
    current.description = parsed.name || current.description;
    current.values = parsed.values;
    current.assumptions = parsed.assumptions;
    current.reason = null;
    fs.rmSync(photoPath(id), { force: true });
    persist();
  } catch (err) {
    const current = items.find((candidate) => candidate.id === id);
    if (!current) return;
    current.status = 'empty';
    current.values = {};
    current.reason = err instanceof Error ? err.message : 'the estimator failed';
    persist();
  }
}

export async function adjustDay(day: string, feedback: string): Promise<{ error?: string }> {
  const dayItems = itemsForDay(day).filter((item) => item.status === 'ready');
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

  const prompt = `You adjust queued meals for one day of a calorie log.

The person said: "${feedback}"

These are the meals, already estimated:

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
    const item = items.find((candidate) => candidate.id === id);
    if (!item || item.status !== 'ready') continue;

    if (typeof raw.description === 'string' && raw.description.trim()) {
      item.description = raw.description.trim().slice(0, 80);
    }
    if (typeof raw.assumptions === 'string') {
      item.assumptions = raw.assumptions.trim();
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
      if (ok) item.values = values;
    }
  }

  persist();
  return {};
}

/** Resume anything still working after a restart — the bytes are on disk. */
export function resumeWorking(): void {
  for (const item of items) {
    if (item.status === 'working') void processItem(item.id);
  }
}
