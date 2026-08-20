import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import type { FieldConfig, PendingEstimate } from '../../shared/calories.js';
import { trackedFields } from './settings.js';

/**
 * Estimating a meal by shelling out to Grok Build (`grok -p`) on the box.
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
function resolveGrok(): string | null {
  const candidates = [
    process.env.ZIMADASH_GROK_BIN,
    path.join(os.homedir(), '.local/bin/grok'),
    path.join(os.homedir(), '.grok/bin/grok'),
    '/usr/local/bin/grok',
    '/opt/homebrew/bin/grok',
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

/** An empty cwd so Grok does not walk up into the deploy tree and ingest this
 *  repo's AGENTS.md as project context for a meal estimate. */
function scratchDir(): string {
  const dir = path.join(os.tmpdir(), 'zimadash-estimator');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// The CLI's own words when its session has lapsed — matched against stdout
// *and* stderr because which stream it lands on isn't reliable, and it has
// been seen to exit 0 even while saying this.
const AUTH_FAILURE_PATTERN =
  /oauth session expired|failed to authenticate|not logged in|not signed in|authentication failed|unauthorized/i;

function firstLine(text: string, max = 200): string {
  const line = text.split('\n').find((l) => l.trim().length > 0) ?? '';
  return line.trim().slice(0, max);
}

/** `grok -p --output-format json` wraps the model's reply in `{ text }`. */
function extractText(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed.startsWith('{')) return stdout;
  try {
    const body = JSON.parse(trimmed) as { text?: unknown };
    if (typeof body.text === 'string') return body.text;
  } catch {
    /* the model itself replied with JSON; parse() will pick it out */
  }
  return stdout;
}

function failedAuth(stdout: string, stderr: string): boolean {
  if (AUTH_FAILURE_PATTERN.test(stdout) || AUTH_FAILURE_PATTERN.test(stderr)) return true;
  try {
    const body = JSON.parse(stdout.trim()) as { type?: unknown; message?: unknown };
    return (
      body.type === 'error' &&
      typeof body.message === 'string' &&
      AUTH_FAILURE_PATTERN.test(body.message)
    );
  } catch {
    return false;
  }
}

export function complete(prompt: string, tools: string, timeoutMs = TIMEOUT_MS): Promise<string> {
  const bin = resolveGrok();
  if (!bin) throw new Error('the estimator is not installed on this server');

  const args = [
    '-p',
    prompt,
    '--tools',
    tools,
    '--no-subagents',
    '--no-plan',
    '--always-approve',
    '--output-format',
    'json',
    '--verbatim',
    '--cwd',
    scratchDir(),
  ];
  if (!tools) args.push('--disable-web-search');

  const env = {
    ...process.env,
    GROK_DISABLE_AUTOUPDATER: '1',
    GROK_MEMORY: '0',
  };

  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      { timeout: timeoutMs, maxBuffer: MAX_OUTPUT, env },
      (err, stdout, stderr) => {
        if (failedAuth(stdout, stderr)) {
          reject(new Error('the estimator is not logged in on the server'));
          return;
        }
        if (err) {
          if (err.killed) {
            reject(new Error('the estimator timed out'));
            return;
          }
          const detail = firstLine(stderr) || firstLine(stdout);
          reject(
            new Error(
              detail ? `the estimator failed to run: ${detail}` : 'the estimator failed to run',
            ),
          );
          return;
        }
        resolve(extractText(stdout));
      },
    );
  });
}

function run(prompt: string, withImage = false): Promise<string> {
  // Search is always available so a branded or restaurant item can be looked up
  // rather than guessed at; read_file is added only when there is a photograph
  // to look at. Nothing else is ever allowed — in particular not web_fetch,
  // which would let a crafted description send this box to an arbitrary URL.
  return complete(prompt, withImage ? 'web_search,read_file' : 'web_search');
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

You may search the web when the meal names something you do not reliably know —
a brand, a specific restaurant dish, a packaged product. Don't search for
ordinary food you can already estimate; it costs seconds and buys nothing. If
you did look something up, say so in "assumptions".

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
  if (!match) throw new Error("the estimator's reply could not be read");

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
    // A run() failure — auth, a missing binary, a timeout — is the same
    // problem every time, so it isn't retried; it would just cost another 90
    // seconds to fail the same way twice. Only a bad reply from a successful
    // run is retried, since that's usually a one-off.
    const output = await run(prompt, withImage);
    try {
      return parse(output, fields);
    } catch {
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
  // Inside the scratch cwd so Grok's read_file grant can actually open it.
  const file = path.join(scratchDir(), `meal-${crypto.randomBytes(8).toString('hex')}.jpg`);
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
