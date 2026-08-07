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

function run(prompt: string): Promise<string> {
  const bin = resolveClaude();
  if (!bin) throw new Error('the estimator is not available on this server');

  return new Promise((resolve, reject) => {
    execFile(bin, ['-p', prompt], { timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT }, (err, stdout) => {
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

function buildPrompt(fields: FieldConfig[], transcript: string[]): string {
  const now = new Date();
  const clock = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const day = now.toLocaleDateString([], { weekday: 'long' });

  return `You estimate the nutritional content of a meal from a short description.

It is ${clock} on a ${day}, which should inform whether this reads as breakfast,
lunch, dinner, or a snack, and therefore what a typical portion looks like.

${transcript.join('\n\n')}

Reply with a single JSON object and nothing else — no prose, no code fence:

{
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

async function estimate(transcript: string[]): Promise<Parsed> {
  const fields = trackedFields();
  const prompt = buildPrompt(fields, transcript);

  return serialise(async () => {
    try {
      return parse(await run(prompt), fields);
    } catch (first) {
      // One retry, because a malformed reply is usually a one-off. Twice in a
      // row is a real problem and shouldn't cost another 90 seconds.
      if (first instanceof Error && first.message === 'the estimator did not respond') throw first;
      return parse(await run(prompt), fields);
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

export async function startEstimate(description: string): Promise<PendingEstimate> {
  const transcript = [`Meal: ${description}`];
  const { values, assumptions } = await estimate(transcript);

  if (threads.size >= MAX_THREADS) {
    const oldest = threads.keys().next().value;
    if (oldest !== undefined) threads.delete(oldest);
  }

  const thread: Thread = {
    id: crypto.randomBytes(8).toString('hex'),
    description,
    values,
    assumptions,
    rounds: 0,
    transcript: [...transcript, `You estimated: ${JSON.stringify({ values, assumptions })}`],
  };
  threads.set(thread.id, thread);

  return toPending(thread);
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
