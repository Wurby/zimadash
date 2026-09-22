import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FieldConfig } from '../../shared/calories.js';
import { trackedFields } from './settings.js';
import { runBrain } from '../../brainQueue.js';

/**
 * Estimating a meal by shelling out to the Claude CLI (`claude -p`) on the box.
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

/** An empty cwd so the brain does not walk up into the deploy tree and ingest
 *  this repo's own AGENTS.md/CLAUDE.md as project context for a meal estimate.
 *  The user-level ~/.claude/CLAUDE.md still loads regardless of cwd — there is
 *  no flag that suppresses it short of --bare, which drops OAuth/subscription
 *  auth entirely, so that cost is accepted rather than worked around. */
function scratchDir(): string {
  const dir = path.join(os.tmpdir(), 'zimadash-estimator');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// The CLI's own words when its session has lapsed — matched against stdout
// *and* stderr because which stream it lands on isn't reliable, and it prints
// this as plain text (not the JSON envelope) while still exiting 0.
const AUTH_FAILURE_PATTERN =
  /not logged in|login expired|please run \/login|invalid api key|failed to authenticate|authentication failed|unauthorized/i;

function firstLine(text: string, max = 200): string {
  const line = text.split('\n').find((l) => l.trim().length > 0) ?? '';
  return line.trim().slice(0, max);
}

interface ResultEnvelope {
  type?: unknown;
  result?: unknown;
  is_error?: unknown;
}

/** `claude -p --output-format json` wraps a successful reply in
 *  `{ type: "result", result, is_error: false, ... }`. Exit code is 0 even on
 *  an internal failure (a bad prompt, a refusal, hitting a budget) — `is_error`
 *  is the real signal, not the process exit code. */
function parseEnvelope(stdout: string): ResultEnvelope | null {
  const trimmed = stdout.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    return JSON.parse(trimmed) as ResultEnvelope;
  } catch {
    return null;
  }
}

function extractText(stdout: string): string {
  const body = parseEnvelope(stdout);
  if (!body) return stdout;
  if (body.is_error === true) {
    const detail = typeof body.result === 'string' ? body.result.trim() : '';
    throw new Error(
      detail ? `the estimator failed: ${detail.slice(0, 200)}` : 'the estimator failed',
    );
  }
  return typeof body.result === 'string' ? body.result : stdout;
}

function failedAuth(stdout: string, stderr: string): boolean {
  if (AUTH_FAILURE_PATTERN.test(stdout) || AUTH_FAILURE_PATTERN.test(stderr)) return true;
  const body = parseEnvelope(stdout);
  return typeof body?.result === 'string' && AUTH_FAILURE_PATTERN.test(body.result);
}

export function complete(
  prompt: string,
  tools: string,
  timeoutMs = TIMEOUT_MS,
  cwd = scratchDir(),
): Promise<string> {
  const bin = resolveClaude();
  if (!bin) throw new Error('the estimator is not installed on this server');

  // 0 would mean "immediately" on some timer paths and "never" on others.
  // Never spawn an uncapped process: the queue is the concurrency cap, this
  // is the hang cap.
  const ms = timeoutMs > 0 ? timeoutMs : TIMEOUT_MS;

  const args = [
    '-p',
    prompt,
    // Restricts which built-in tools exist at all, not just which are
    // pre-approved — the model literally cannot reach for Bash/Edit/Write.
    '--tools',
    tools,
    // 'sonnet' is a rolling alias to the latest Sonnet, not a pinned version —
    // Opus is the account default and overkill (and pricier) for a JSON
    // extraction task like this one.
    '--model',
    'sonnet',
    '--permission-mode',
    'bypassPermissions',
    '--output-format',
    'json',
    // No --mcp-config is passed, so this loads zero MCP servers and skips
    // every skill — a meal estimate has no business paying for that context.
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--setting-sources',
    '',
    '--no-session-persistence',
  ];

  return runBrain(
    () =>
      new Promise<string>((resolve, reject) => {
        const child = execFile(
          bin,
          args,
          { cwd, timeout: ms, maxBuffer: MAX_OUTPUT, killSignal: 'SIGKILL' },
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
            try {
              resolve(extractText(stdout));
            } catch (parseErr) {
              reject(parseErr instanceof Error ? parseErr : new Error('the estimator failed'));
            }
          },
        );
        // Verified live: claude -p reads whatever is available on stdin and
        // folds it into the prompt. Nothing should ever reach the model but
        // the prompt string, so stdin is closed rather than left open-unfed.
        child.stdin?.end();
      }),
  );
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

export interface Parsed {
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

/** Search is always available so a branded or restaurant item can be looked up
 *  rather than guessed at. Read is added only when there is a photograph to
 *  look at — nothing else is ever granted, in particular not WebFetch, which
 *  would let a crafted description send this box to an arbitrary URL. */
function run(prompt: string, imagePath?: string, timeoutMs = TIMEOUT_MS): Promise<string> {
  const tools = imagePath ? 'WebSearch,Read' : 'WebSearch';
  return complete(prompt, tools, timeoutMs);
}

/**
 * Run an estimate off the HTTP request. The queue uses a long watchdog
 * (30 minutes); a synchronous route would need the short tunnel budget
 * instead, so nothing reaching the brain is ever awaited directly on a
 * response — every caller queues and polls.
 */
export async function estimateMeal(
  transcript: string[],
  imagePath?: string,
  timeoutMs = TIMEOUT_MS,
): Promise<Parsed> {
  const fields = trackedFields();
  const prompt = buildPrompt(fields, transcript, imagePath);

  const output = await run(prompt, imagePath, timeoutMs);
  try {
    return parse(output, fields);
  } catch {
    return parse(await run(prompt, imagePath, timeoutMs), fields);
  }
}

/** Write a photographed meal to disk as a plain image file. The brain reads it
 *  by path (granted `Read`) rather than receiving it inline — there is no
 *  headless equivalent of an inline image block for a one-shot `-p` call. */
export function writePhotoFile(base64: string, dest: string): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
  fs.writeFileSync(dest, Buffer.from(base64, 'base64'), { mode: 0o600 });
}

/**
 * Re-estimate a meal that's already been logged, from a spoken correction.
 * Returns the new numbers directly — the caller applies them; there is no
 * pending/multi-round thread here, since nothing downstream ever resumed one.
 */
export async function reestimateEntry(
  description: string,
  values: Record<string, number>,
  feedback: string,
): Promise<Parsed> {
  const transcript = [
    `Meal: ${description || 'a previously logged meal'}`,
    `It was recorded as: ${JSON.stringify(values)}`,
    `Correction from the person who ate it: ${feedback}`,
  ];
  return estimateMeal(transcript);
}
