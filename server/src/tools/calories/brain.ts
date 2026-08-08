import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import type { FieldConfig, PendingEstimate } from '../../shared/calories.js';
import { trackedFields } from './settings.js';

/**
 * Estimating a meal by shelling out to the Claude CLI on the box.
 *
 * The CLI rather than the API on purpose: it runs on the subscription that is
 * already paid for, which is the entire reason this tool exists instead of a
 * £70-a-year app. The cost is latency — a process spawn plus model time — and
 * that the tool goes dark the day that CLI's auth lapses. There is deliberately
 * no fallback to logging a bare number: a silently unestimated meal is worse
 * than a visible failure.
 */

const TIMEOUT_MS = 90_000;
const MAX_OUTPUT = 1024 * 1024;

/** systemd gives the unit a minimal PATH, so the CLI has to be found by hand. */
function resolveClaude(): string | null {
  const candidates = [
    process.env.ZIMADASH_CLAUDE_BIN,
    path.join(os.homedir(), '.local/bin/claude'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      /* try the next one */
    }
  }
  return null;
}

function run(prompt: string, withImage = false): Promise<string> {
  const bin = resolveClaude();
  if (!bin) throw new Error('the estimator is not available on this server');

  // Text estimates run with no tools at all. Reading a photograph is the only
  // thing that needs one, so Read is granted only for that call and nothing
  // else is ever allowed — this process handles input from the open internet.
  const args = withImage ? ['-p', prompt, '--allowed-tools', 'Read'] : ['-p', prompt];

  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT }, (err, stdout) => {
      if (err) {
        reject(new Error('the estimator did not respond'));
        return;
      }
      resolve(stdout);
    });
  });
}

function describeFields(fields: FieldConfig[]): string {
  return fields
    .map((field) => `  "${field.id}" — ${field.label}${field.unit ? ` in ${field.unit}` : ''}`)
    .join('\n');
}

function buildPrompt(fields: FieldConfig[], transcript: string[], imagePath?: string): string {
  const now = new Date();
  const clock = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const day = now.toLocaleDateString([], { weekday: 'long' });

  const image = imagePath
    ? `Read the image at ${imagePath}. It is a photograph of the meal. Judge the
portion from what is on the plate and from anything in shot that gives scale —
cutlery, a hand, the size of the plate itself.

`
    : '';

  return `You estimate the nutritional content of a meal.

It is ${clock} on a ${day}, which should inform whether this reads as breakfast,
lunch, dinner, or a snack, and therefore what a typical portion looks like.

${image}${transcript.join('\n\n')}

Reply with a single JSON object and nothing else — no prose, no code fence:

{
  "name": "<three or four words naming the meal>",
  "values": {
${fields.map((f) => `    "${f.id}": <number>`).join(',\n')}
  },
  "assumptions": "<one short sentence: the portion size and ingredients you assumed>"
}

Every key under "values" is required and must be a plain number, not a string
and not a range. Estimate rather than refuse — an approximate number is the
point. Keep "assumptions" to one sentence; it is what gets corrected.

Fields:
${describeFields(fields)}`;
}

interface Parsed {
  name: string;
  values: Record<string, number>;
  assumptions: string;
}

function parse(reply: string, fields: FieldConfig[]): Parsed {
  // Tolerate a code fence or a stray sentence around the object.
  const match = reply.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('unparseable');

  const body = JSON.parse(match[0]) as Partial<Parsed>;
  const values: Record<string, number> = {};

  for (const field of fields) {
    const raw = body.values?.[field.id];
    const value = typeof raw === 'string' ? Number(raw) : raw;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`missing ${field.id}`);
    }
    values[field.id] = Math.round(value * 10) / 10;
  }

  return {
    name: typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '',
    values,
    assumptions: typeof body.assumptions === 'string' ? body.assumptions.trim() : '',
  };
}

/**
 * One estimate at a time. Each call is a process, and a burst of them would
 * bury a small box — and nothing here is worth answering concurrently.
 */
let queue: Promise<unknown> = Promise.resolve();

function serialise<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
}

async function estimate(transcript: string[], imagePath?: string): Promise<Parsed> {
  const fields = trackedFields();
  const prompt = buildPrompt(fields, transcript, imagePath);
  const withImage = imagePath !== undefined;

  return serialise(async () => {
    try {
      return parse(await run(prompt, withImage), fields);
    } catch (first) {
      // One retry, because a malformed reply is usually a one-off. Twice in a
      // row is a real problem and shouldn't cost another 90 seconds.
      if (first instanceof Error && first.message === 'the estimator did not respond') throw first;
      return parse(await run(prompt, withImage), fields);
    }
  });
}

// ─── Pending threads ─────────────────────────────────────────────────────────
// Held in memory on purpose. A phone lock or an app switch leaves the thread
// waiting; a server restart clears it and you start over. That is the behaviour
// asked for, and it means no half-finished meals accumulate on disk.

interface Thread extends PendingEstimate {
  transcript: string[];
}

const threads = new Map<string, Thread>();
const MAX_THREADS = 20;

function remember(description: string, transcript: string[], parsed: Parsed): PendingEstimate {
  if (threads.size >= MAX_THREADS) {
    const oldest = threads.keys().next().value;
    if (oldest !== undefined) threads.delete(oldest);
  }

  const thread: Thread = {
    id: crypto.randomBytes(8).toString('hex'),
    description,
    values: parsed.values,
    assumptions: parsed.assumptions,
    rounds: 0,
    // The estimate goes into the transcript so a later correction has the
    // numbers to work from — which is also what lets a photo be refined by text
    // after its file is gone.
    transcript: [...transcript, `You estimated: ${JSON.stringify(parsed)}`],
  };
  threads.set(thread.id, thread);

  return toPending(thread);
}

export async function startEstimate(description: string): Promise<PendingEstimate> {
  const transcript = [`Meal: ${description}`];
  return remember(description, transcript, await estimate(transcript));
}

/**
 * Estimate from a photograph.
 *
 * The image is written to the OS temp directory, read once, and deleted in a
 * finally — it never touches DATA_DIR and never outlives the call. What
 * survives is the model's own name for the meal and its numbers, which is
 * enough for the refinement rounds to work on afterwards without the picture.
 */
export async function startImageEstimate(base64: string): Promise<PendingEstimate> {
  const file = path.join(os.tmpdir(), `zimadash-meal-${crypto.randomBytes(8).toString('hex')}.jpg`);
  fs.writeFileSync(file, Buffer.from(base64, 'base64'), { mode: 0o600 });

  try {
    const parsed = await estimate(['Meal: the photograph.'], file);
    const description = parsed.name || 'photographed meal';
    return remember(description, [`Meal: ${description}, from a photograph.`], parsed);
  } finally {
    fs.rmSync(file, { force: true });
  }
}

/**
 * Re-estimate a meal that's already been logged.
 *
 * Seeds a normal thread from what was recorded, so everything downstream — the
 * refinement rounds, the expiry, the memory-only lifetime — behaves exactly as
 * it does for a fresh estimate. The difference is only what happens on approval:
 * this updates the entry rather than creating one.
 */
export async function reestimateEntry(
  description: string,
  values: Record<string, number>,
  feedback: string,
): Promise<PendingEstimate> {
  const transcript = [
    `Meal: ${description || 'a previously logged meal'}`,
    `It was recorded as: ${JSON.stringify(values)}`,
    `Correction from the person who ate it: ${feedback}`,
  ];
  return remember(description, transcript, await estimate(transcript));
}

export async function refineEstimate(
  id: string,
  feedback: string,
): Promise<PendingEstimate | null> {
  const thread = threads.get(id);
  if (!thread) return null;

  thread.transcript.push(`Correction from the person who ate it: ${feedback}`);
  const { values, assumptions } = await estimate(thread.transcript);

  thread.values = values;
  thread.assumptions = assumptions;
  thread.rounds += 1;
  thread.transcript.push(`You estimated: ${JSON.stringify({ values, assumptions })}`);

  return toPending(thread);
}

export function takeThread(id: string): PendingEstimate | null {
  const thread = threads.get(id);
  if (!thread) return null;
  threads.delete(id);
  return toPending(thread);
}

function toPending(thread: Thread): PendingEstimate {
  return {
    id: thread.id,
    description: thread.description,
    values: thread.values,
    assumptions: thread.assumptions,
    rounds: thread.rounds,
  };
}
