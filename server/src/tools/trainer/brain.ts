import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { runGrok } from '../../grokQueue.js';
import {
  IMPLEMENTS,
  loadLadder,
  nextPrescription,
  snapToRung,
  type ExerciseDef,
  type Implement,
  type Inventory,
  type Session,
  type SessionExercise,
  type SessionType,
} from '../../shared/trainer.js';
import { rememberExercises } from './settings.js';

/**
 * Planning a session by shelling out to Grok Build (`grok -p`) on the box.
 *
 * The same bargain the calorie estimator makes: the CLI runs on a subscription
 * that already exists, and the cost is several seconds and going dark the day
 * that auth lapses.
 *
 * **What the model is actually for.** Not arithmetic — the adjustment rule is a
 * lookup and the loads are a closed ladder, so both are computed here and handed
 * over as context. What it brings is judgement: which exercises this session
 * given what's gone stale, when a complex or a density set earns its slot, what
 * to load a lift with no history from a related one, and the written cues.
 *
 * **No tools at all.** The estimator needs search because a meal can name a
 * restaurant dish; this needs nothing it isn't given. An empty grant is the
 * smallest one that works, so that's what it gets. Invented movement names
 * are saved into the catalogue so they can repeat; the equipment is what
 * decides whether a movement is possible.
 *
 * Unlike the estimator there *is* a correct fallback — the rule-based planner
 * makes a serviceable session on its own — so a failure here is offered rather
 * than fatal. It is never substituted silently: `plannedBy` records which you
 * got.
 */

const TIMEOUT_MS = 120_000;
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
 *  repo's AGENTS.md — or the brief — as project context. */
function scratchDir(): string {
  const dir = path.join(os.tmpdir(), 'zimadash-planner');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
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

function run(prompt: string): Promise<string> {
  const bin = resolveGrok();
  if (!bin) throw new Error('the planner is not available on this server');

  const env = {
    ...process.env,
    GROK_DISABLE_AUTOUPDATER: '1',
    GROK_MEMORY: '0',
  };

  return runGrok(
    () =>
      new Promise<string>((resolve, reject) => {
        execFile(
          bin,
          [
            '-p',
            prompt,
            '--tools',
            '',
            '--no-subagents',
            '--no-plan',
            '--disable-web-search',
            '--always-approve',
            '--output-format',
            'json',
            '--verbatim',
            '--cwd',
            scratchDir(),
          ],
          { timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT, killSignal: 'SIGKILL', env },
          (err, stdout) =>
            err ? reject(new Error('the planner did not respond')) : resolve(extractText(stdout)),
        );
      }),
  );
}

interface Candidate {
  definition: ExerciseDef;
  ladder: number[];
  last: { date: string; weightLb: number; sets: number; reps: number; rating: string } | null;
  suggestion: { weightLb: number; sets: number; reps: number; because: string } | null;
}

/** Everything the model needs to know about one exercise, already reasoned
 *  over. */
function describe(candidate: Candidate): string {
  const { definition, ladder, last, suggestion } = candidate;
  const bits = [
    `- ${definition.name} (${definition.kind}${definition.kneeLoaded ? ', KNEE-LOADED' : ''}${definition.complex ? ', complex' : ''})`,
    `    loads available: ${ladder.length > 1 ? ladder.join(', ') : 'bodyweight only'}`,
  ];

  if (last) {
    bits.push(
      `    last done ${last.date}: ${last.weightLb}lb ${last.sets}x${last.reps}, rated "${last.rating}"`,
    );
  } else {
    bits.push('    never done');
  }

  if (suggestion) {
    bits.push(
      `    the rule says: ${suggestion.weightLb}lb ${suggestion.sets}x${suggestion.reps} (${suggestion.because})`,
    );
  }
  if (definition.cue) bits.push(`    usual cue: ${definition.cue}`);
  if (definition.note) bits.push(`    note: ${definition.note}`);

  return bits.join('\n');
}

function describeInventory(inventory: Inventory): string {
  const plates =
    inventory.plates
      .filter((pair) => pair.pairs > 0)
      .map((pair) => `${pair.pairs}× ${pair.lb}lb pairs`)
      .join(', ') || 'none';
  const dumbbells =
    inventory.dumbbells
      .filter((pair) => pair.pairs > 0)
      .map((pair) => `${pair.pairs}× ${pair.lb}lb`)
      .join(', ') || 'none';
  return `Bar: ${inventory.barLb}lb\nPlates: ${plates}\nDumbbells: ${dumbbells}`;
}

const SESSION_TYPES: SessionType[] = ['Upper A', 'Lower', 'Upper B'];

function buildPrompt(
  type: SessionType,
  policy: string,
  candidates: Candidate[],
  inventory: Inventory,
): string {
  const pool =
    candidates.length > 0
      ? `Known repeats — prefer these when they still fit, and honour any note as a constraint:\n\n${candidates.map(describe).join('\n')}`
      : 'The catalogue is empty. Invent a full session from the equipment.';

  return `You are planning one strength-training session for someone who trains at home.

Today's session is **${type}**.

${policy ? `Their brief, which governs everything below:\n\n${policy}\n\n` : ''}The equipment they have. Every load must be assemblable from this; a weight that cannot be built is not an option.

${describeInventory(inventory)}

Implements: bar (EZ bar + plates both sides), plates (plates only, no bar), dumbbell-pair, dumbbell-single, bodyweight, bodyweight-plus.

${pool}

You may invent a movement the equipment can actually do. The catalogue informs repeats and constraints; it is not an allow-list. Equipment decides what is possible.

Where there is history, the adjustment rule has already been applied and its result is given as "the rule says"; follow it unless you have a specific reason not to, and say so in "reasoning" if you depart from it.

Aim for about 45 minutes — usually five or six exercises, fewer if the sets run
long. Lead with the compounds. Don't repeat a muscle group needlessly, and don't
let one get skipped entirely.

Reply with a single JSON object and nothing else — no prose, no code fence:

{
  "exercises": [
    {
      "name": "<pool name exactly, or a new name>",
      "weightLb": <number assemblable on that movement's implement>,
      "sets": <number>,
      "reps": <number>,
      "format": "straight" | "complex" | "density",
      "instructions": "<one or two sentences: how to perform it, and what to watch. This is read aloud mid-set, so make it about doing the movement — never about why it was chosen.>",
      "implement": "<required for a new name>",
      "kind": "compound" | "accessory",
      "days": ["Upper A" | "Lower" | "Upper B"],
      "kneeLoaded": <boolean>,
      "note": "<why it was chosen. Never spoken.>"
    }
  ],
  "reasoning": "<one short sentence on the shape of today's session>"
}

For a name already in the pool, omit implement/kind/days/kneeLoaded/note.
For a new name they are required.

"instructions" is spoken out loud while they are stood in front of the weight.
Write it as cueing, not commentary. For anything marked KNEE-LOADED, the cueing
must cover controlling the descent and keeping the knees tracking over the toes.`;
}

interface Planned {
  name: string;
  weightLb: number;
  sets: number;
  reps: number;
  format: 'straight' | 'complex' | 'density';
  instructions: string;
  definition: ExerciseDef;
  invented: boolean;
}

function parseImplement(value: unknown): Implement | null {
  return typeof value === 'string' && (IMPLEMENTS as string[]).includes(value)
    ? (value as Implement)
    : null;
}

function parseDays(value: unknown, fallback: SessionType): SessionType[] {
  const raw = Array.isArray(value) ? value : [];
  const days = raw.filter((day): day is SessionType => SESSION_TYPES.includes(day as SessionType));
  return days.length > 0 ? days : [fallback];
}

function parse(
  reply: string,
  candidates: Candidate[],
  inventory: Inventory,
  sessionType: SessionType,
): { exercises: Planned[]; reasoning: string } {
  // Tolerate a code fence or a stray sentence around the object.
  const match = reply.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('unparseable');

  const body = JSON.parse(match[0]) as {
    exercises?: unknown;
    reasoning?: unknown;
  };

  if (!Array.isArray(body.exercises) || body.exercises.length === 0) {
    throw new Error('no exercises');
  }

  const exercises: Planned[] = [];

  for (const raw of body.exercises as Record<string, unknown>[]) {
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    if (!name) throw new Error('an exercise is missing a name');

    const found = candidates.find((candidate) => candidate.definition.name === name);

    let definition: ExerciseDef;
    let ladder: number[];
    let invented = false;

    if (found) {
      definition = found.definition;
      ladder = found.ladder;
    } else {
      const implement = parseImplement(raw.implement);
      if (!implement) throw new Error(`"${name}" needs an implement`);
      const kind = raw.kind === 'accessory' ? 'accessory' : 'compound';
      const cue = typeof raw.instructions === 'string' ? raw.instructions.trim().slice(0, 600) : '';
      const note = typeof raw.note === 'string' ? raw.note.trim().slice(0, 400) : '';
      definition = {
        name,
        implement,
        kind,
        days: parseDays(raw.days, sessionType),
        kneeLoaded: raw.kneeLoaded === true,
        complex: raw.format === 'complex',
        cue,
        note: note || undefined,
      };
      ladder = loadLadder(inventory, implement);
      invented = true;
    }

    const number = (value: unknown) => (typeof value === 'string' ? Number(value) : value);
    const sets = number(raw.sets);
    const reps = number(raw.reps);
    const weight = number(raw.weightLb);

    if (typeof sets !== 'number' || !Number.isFinite(sets) || sets < 1) {
      throw new Error(`${definition.name}: bad sets`);
    }
    if (typeof reps !== 'number' || !Number.isFinite(reps) || reps < 1) {
      throw new Error(`${definition.name}: bad reps`);
    }
    if (typeof weight !== 'number' || !Number.isFinite(weight)) {
      throw new Error(`${definition.name}: bad weight`);
    }

    exercises.push({
      name: definition.name,
      // Snapped rather than rejected: the ladder is the authority, and being a
      // rung out is a rounding slip rather than a misunderstanding.
      weightLb: snapToRung(ladder, weight),
      sets: Math.round(sets),
      reps: Math.round(reps),
      format: raw.format === 'complex' || raw.format === 'density' ? raw.format : 'straight',
      instructions:
        typeof raw.instructions === 'string'
          ? raw.instructions.trim().slice(0, 600)
          : (definition.cue ?? ''),
      definition,
      invented,
    });
  }

  return {
    exercises,
    reasoning: typeof body.reasoning === 'string' ? body.reasoning.trim().slice(0, 300) : '',
  };
}

/** One plan at a time. Each call is a process, and a small box shouldn't be
 *  running two. */
let queue: Promise<unknown> = Promise.resolve();

function serialise<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
}

export function candidatesFor(
  type: SessionType,
  catalogue: ExerciseDef[],
  inventory: Inventory,
  history: Session[],
): Candidate[] {
  const seen = new Map<
    string,
    { date: string; weightLb: number; sets: number; reps: number; rating: string }
  >();

  for (const session of history) {
    for (const exercise of session.exercises) {
      const result = exercise.result;
      if (!result || result.skipped) continue;
      const previous = seen.get(exercise.name);
      if (previous && previous.date > session.date) continue;
      seen.set(exercise.name, {
        date: session.date,
        weightLb: result.weightLb,
        sets: result.sets,
        reps: result.reps,
        rating: result.rating,
      });
    }
  }

  return catalogue
    .filter((definition) => definition.days.includes(type))
    .map((definition) => {
      const ladder = loadLadder(inventory, definition.implement);
      const last = seen.get(definition.name) ?? null;

      return {
        definition,
        ladder,
        last,
        suggestion: last
          ? nextPrescription(
              { weightLb: last.weightLb, sets: last.sets, reps: last.reps },
              last.rating as never,
              ladder,
              { kneeLoaded: definition.kneeLoaded },
            )
          : null,
      };
    });
}

export async function planWithModel(
  type: SessionType,
  policy: string,
  catalogue: ExerciseDef[],
  inventory: Inventory,
  history: Session[],
  today: string,
): Promise<{ session: Session; reasoning: string }> {
  const candidates = candidatesFor(type, catalogue, inventory, history);
  const prompt = buildPrompt(type, policy, candidates, inventory);

  const parsed = await serialise(async () => {
    try {
      return parse(await run(prompt), candidates, inventory, type);
    } catch (first) {
      // One retry — a malformed reply is usually a one-off, and twice in a row
      // is a real problem that shouldn't cost another two minutes.
      if (first instanceof Error && first.message === 'the planner did not respond') throw first;
      return parse(await run(prompt), candidates, inventory, type);
    }
  });

  rememberExercises(
    parsed.exercises.filter((planned) => planned.invented).map((planned) => planned.definition),
  );

  const exercises: SessionExercise[] = parsed.exercises.map((planned) => {
    const definition = planned.definition;

    return {
      name: planned.name,
      implement: definition.implement,
      kneeLoaded: definition.kneeLoaded,
      format: planned.format,
      prescribed: { weightLb: planned.weightLb, sets: planned.sets, reps: planned.reps },
      instructions: planned.instructions || definition.cue,
      result: null,
    };
  });

  return {
    session: {
      id: randomUUID(),
      date: today,
      type,
      status: 'planned',
      cursor: 0,
      exercises,
      plannedBy: 'model',
    },
    reasoning: parsed.reasoning,
  };
}

// ─── Detailed guidance ───────────────────────────────────────────────────────

/**
 * The long-form how-to for one movement.
 *
 * Separate from session planning because it is a property of the exercise
 * rather than of today — which is what makes it worth caching. The brief is
 * still included, since the knee protocol and the no-cardio rule shape how a
 * movement should be described, and a hash of it decides when a cached guide
 * has gone stale.
 */
function buildGuidePrompt(definition: ExerciseDef, policy: string, ladder: number[]): string {
  return `Explain how to perform one strength exercise, for someone training alone at home.

Exercise: ${definition.name}
Loaded with: ${definition.implement.replace('-', ' ')}${
    ladder.length > 1 ? ` (available loads: ${ladder.join(', ')} lb)` : ''
  }
${definition.kneeLoaded ? 'This movement loads the knee. The cueing must cover controlling the descent and keeping the knees tracking over the toes.\n' : ''}${
    definition.cue ? `The short cue already in use: ${definition.cue}\n` : ''
  }${policy ? `\nTheir brief, which governs how this should be described:\n\n${policy}\n` : ''}
Write it for someone stood in front of the weight about to lift, not for a
textbook. Assume no spotter, no rack, and no coach in the room. It may be read
aloud, so write plain sentences — no markdown, no lists inside a string, no
abbreviations that only make sense on a page.

Reply with a single JSON object and nothing else — no prose, no code fence:

{
  "setup": "<one or two sentences: how to get into position before the first rep>",
  "steps": ["<each rep, in order — three to five short sentences>"],
  "watchFor": ["<two to four things that commonly go wrong, and what to do instead>"]
}`;
}

function parseGuide(reply: string): { setup: string; steps: string[]; watchFor: string[] } {
  const match = reply.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('unparseable');

  const body = JSON.parse(match[0]) as Record<string, unknown>;
  const list = (value: unknown, cap: number): string[] =>
    Array.isArray(value)
      ? value
          .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
          .map((entry) => entry.trim().slice(0, 400))
          .slice(0, cap)
      : [];

  const setup = typeof body.setup === 'string' ? body.setup.trim().slice(0, 600) : '';
  const steps = list(body.steps, 6);

  // A guide with no setup or no steps is not a guide — better to fail and let
  // the retry run than to expand a panel onto an empty screen mid-set.
  if (!setup || steps.length === 0) throw new Error('incomplete guide');

  return { setup, steps, watchFor: list(body.watchFor, 5) };
}

export async function explainExercise(
  definition: ExerciseDef,
  policy: string,
  inventory: Inventory,
): Promise<{ setup: string; steps: string[]; watchFor: string[] }> {
  const prompt = buildGuidePrompt(definition, policy, loadLadder(inventory, definition.implement));

  return serialise(async () => {
    try {
      return parseGuide(await run(prompt));
    } catch (first) {
      if (first instanceof Error && first.message === 'the planner did not respond') throw first;
      return parseGuide(await run(prompt));
    }
  });
}
