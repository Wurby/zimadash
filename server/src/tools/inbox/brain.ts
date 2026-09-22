import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runBrain } from '../../brainQueue.js';

/**
 * Deciding where an uploaded file belongs by shelling out to the Claude CLI
 * (`claude -p`) on the box — the same subscription-CLI bargain as the
 * estimator and the trainer.
 *
 * **Judgement, not placement.** The model never writes anything. It reads
 * <root>/AGENTS.md and explores with Glob/Grep, then returns a decision —
 * a folder, a filename, a confidence, one sentence why. Our own code validates
 * that decision against the root (root.ts's resolveWithin) and performs the
 * actual move. Same boundary as the trainer's weight-snapping: the model
 * chooses, code executes — which is also what makes the traversal check worth
 * doing.
 *
 * **Grant: Read, Grep, Glob, nothing else.** Read opens AGENTS.md and, for a
 * small safe-to-open file, the upload itself. Glob (there is no separate
 * "list directory" tool) and Grep confirm what actually exists against what
 * the layout doc claims. No write, no shell — a decide-only tool has nothing
 * to gain from them. No WebSearch or WebFetch — filing a local file needs no
 * network, and WebFetch stays excluded repo-wide.
 */

const TIMEOUT_MS = 180_000;
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

const AUTH_FAILURE_PATTERN =
  /not logged in|login expired|please run \/login|invalid api key|failed to authenticate|authentication failed|unauthorized/i;

interface ResultEnvelope {
  result?: unknown;
  is_error?: unknown;
}

/** `claude -p --output-format json` wraps a successful reply in
 *  `{ result, is_error: false, ... }`. Exit code is 0 even on an internal
 *  failure, so is_error is the real signal, not the process exit code. */
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
      detail ? `the inbox brain failed: ${detail.slice(0, 200)}` : 'the inbox brain failed',
    );
  }
  return typeof body.result === 'string' ? body.result : stdout;
}

function failedAuth(stdout: string): boolean {
  if (AUTH_FAILURE_PATTERN.test(stdout)) return true;
  const body = parseEnvelope(stdout);
  return typeof body?.result === 'string' && AUTH_FAILURE_PATTERN.test(body.result);
}

function firstLine(text: string, max = 200): string {
  const line = text.split('\n').find((l) => l.trim().length > 0) ?? '';
  return line.trim().slice(0, max);
}

/**
 * cwd matters here in a way it doesn't for the other two brains: Read, Grep
 * and Glob are scoped to the CLI's working directory, and without pinning it
 * to the drop root the model would explore the deployed artifact instead. The
 * staged upload lives outside that root; the brain can still open it by
 * absolute path.
 */
function run(prompt: string, cwd: string): Promise<string> {
  const bin = resolveClaude();
  if (!bin) throw new Error('the inbox brain is not installed on this server');

  return runBrain(
    () =>
      new Promise<string>((resolve, reject) => {
        const child = execFile(
          bin,
          [
            '-p',
            prompt,
            '--tools',
            'Read,Grep,Glob',
            // 'sonnet' is a rolling alias to the latest Sonnet, not a pinned
            // version — Opus is the account default and overkill for a
            // filing decision.
            '--model',
            'sonnet',
            '--permission-mode',
            'bypassPermissions',
            '--output-format',
            'json',
            '--strict-mcp-config',
            '--disable-slash-commands',
            '--setting-sources',
            '',
            '--no-session-persistence',
          ],
          { cwd, timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT, killSignal: 'SIGKILL' },
          (err, stdout, stderr) => {
            if (failedAuth(stdout)) {
              reject(new Error('the inbox brain is not logged in on the server'));
              return;
            }
            if (err) {
              if (err.killed) {
                reject(new Error('the inbox brain timed out'));
                return;
              }
              const detail = firstLine(stderr) || firstLine(stdout);
              reject(
                new Error(
                  detail
                    ? `the inbox brain failed to run: ${detail}`
                    : 'the inbox brain failed to run',
                ),
              );
              return;
            }
            try {
              resolve(extractText(stdout));
            } catch (parseErr) {
              reject(parseErr instanceof Error ? parseErr : new Error('the inbox brain failed'));
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

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Extensions small and safe enough to hand the model via Read — text and
// images the CLI can already open. Everything else is described by name and
// size alone: audio and video carry no textual content Read can use, and
// a large binary risks the output buffer for no benefit.
const READABLE_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.json',
  '.csv',
  '.yaml',
  '.yml',
  '.log',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.pdf',
]);
const READ_SIZE_LIMIT = 5 * 1024 * 1024;

function buildPrompt(
  root: string,
  filename: string,
  size: number,
  stagedPath: string,
  instructions: string,
): string {
  const ext = path.extname(filename).toLowerCase();
  const canRead = READABLE_EXTENSIONS.has(ext) && size <= READ_SIZE_LIMIT;

  const stagedLine = canRead
    ? `  staged at: ${stagedPath} -- read it if that helps place it\n`
    : '';
  const instructionsLine = instructions
    ? `\nWhat the person filing it said: "${instructions}"\n`
    : '';

  return `You decide where one file belongs in a filing system on this machine.

The root of that filing system is ${root}, which is also your working
directory. Read AGENTS.md there first -- it documents the layout and the
rules for what goes where. Then look around with Glob and Grep as far as
you need to. Do not file into a dotfolder (.git, .obsidian, .trash, and the
like) even if it looks like a plausible destination.

The file:
  original name: ${filename}
  type: ${ext || '(none)'}, ${humanSize(size)}
${stagedLine}${instructionsLine}
Reply with a single JSON object and nothing else -- no prose, no code fence:

{
  "folder": "<path relative to the root, / separators, an existing folder
              wherever possible. Never absolute, never containing '..'>",
  "filename": "<the name to save it under>",
  "confidence": <number, 0 to 1>,
  "reasoning": "<one sentence: why there>"
}

If nothing in the layout fits, or the file is too ambiguous to place, return
"folder": "Unsorted" with a low confidence and say why. A truthful low
confidence is worth more than a guess -- a wrong file in a right-looking
folder is harder to find again than one sitting in Unsorted.

You are choosing, not filing. You have no write access and need none.`;
}

export interface Decision {
  folder: string;
  filename: string;
  confidence: number;
  reasoning: string;
}

function parse(reply: string): Decision {
  const match = reply.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('unparseable');

  const body = JSON.parse(match[0]) as Partial<Record<keyof Decision, unknown>>;

  const folder = typeof body.folder === 'string' ? body.folder.trim() : '';
  const filename = typeof body.filename === 'string' ? body.filename.trim() : '';
  if (!folder || !filename) throw new Error('missing folder or filename');

  const rawConfidence =
    typeof body.confidence === 'string' ? Number(body.confidence) : body.confidence;
  const confidence =
    typeof rawConfidence === 'number' && Number.isFinite(rawConfidence)
      ? Math.max(0, Math.min(1, rawConfidence))
      : 0;

  const reasoning = typeof body.reasoning === 'string' ? body.reasoning.trim().slice(0, 300) : '';

  return { folder, filename, confidence, reasoning };
}

export async function decidePlacement(
  root: string,
  filename: string,
  size: number,
  stagedPath: string,
  instructions: string,
): Promise<Decision> {
  const prompt = buildPrompt(root, filename, size, stagedPath, instructions);

  // A run() failure -- auth, a missing binary, a timeout -- is the same
  // problem every time and isn't retried. Only a bad reply from a
  // successful run is, since that's usually a one-off.
  const output = await run(prompt, root);
  try {
    return parse(output);
  } catch {
    return parse(await run(prompt, root));
  }
}
