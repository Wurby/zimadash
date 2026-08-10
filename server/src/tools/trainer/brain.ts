import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  loadLadder,
  nextPrescription,
  snapToRung,
  type ExerciseDef,
  type Inventory,
  type Session,
  type SessionExercise,
  type SessionType,
} from '../../shared/trainer.js';

/**
 * Planning a session by shelling out to the Claude CLI on the box.
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
 * smallest one that works, so that's what it gets.
 *
 * Unlike the estimator there *is* a correct fallback — the rule-based planner
 * makes a serviceable session on its own — so a failure here is offered rather
 * than fatal. It is never substituted silently: `plannedBy` records which you
 * got.
 */

const TIMEOUT_MS = 120_000;
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
  if (!bin) throw new Error('the planner is not available on this server');

  return new Promise((resolve, reject) => {
    execFile(
      bin,
      ['-p', prompt, '--allowed-tools', ''],
      { timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT },
      (err, stdout) => (err ? reject(new Error('the planner did not respond')) : resolve(stdout)),
    );
  });
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

function buildPrompt(type: SessionType, policy: string, candidates: Candidate[]): string {
  return `You are planning one strength-training session for someone who trains at home.

Today's session is **${type}**.

${policy ? `Their brief, which governs everything below:\n\n${policy}\n\n` : ''}Pick the exercises for today from this pool and nothing else. Each one lists
every load their equipment can actually build — a weight not on that list cannot
be assembled and is not an option. Where there is history, the adjustment rule
has already been applied and its result is given as "the rule says"; follow it
unless you have a specific reason not to, and say so in "reasoning" if you
depart from it.

${candidates.map(describe).join('\n')}

Aim for about 45 minutes — usually five or six exercises, fewer if the sets run
long. Lead with the compounds. Don't repeat a muscle group needlessly, and don't
let one get skipped entirely.

Reply with a single JSON object and nothing else — no prose, no code fence:

{
  "exercises": [
    {
      "name": "<exactly as written in the pool above>",
      "weightLb": <number from that exercise's available loads>,
      "sets": <number>,
      "reps": <number>,
      "format": "straight" | "complex" | "density",
      "instructions": "<one or two sentences: how to perform it, and what to watch. This is read aloud mid-set, so make it about doing the movement — never about why it was chosen.>"
    }
  ],
  "reasoning": "<one short sentence on the shape of today's session>"
}

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
}

function parse(
  reply: string,
  candidates: Candidate[],
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
    const found = candidates.find((candidate) => candidate.definition.name === raw.name);
    // An invented exercise is a real failure — it means the pool was ignored,
    // and quietly dropping it would hand back a session missing a muscle group.
    if (!found) throw new Error(`"${String(raw.name)}" is not in the pool`);

    const number = (value: unknown) => (typeof value === 'string' ? Number(value) : value);
    const sets = number(raw.sets);
    const reps = number(raw.reps);
    const weight = number(raw.weightLb);

    if (typeof sets !== 'number' || !Number.isFinite(sets) || sets < 1) {
      throw new Error(`${found.definition.name}: bad sets`);
    }
    if (typeof reps !== 'number' || !Number.isFinite(reps) || reps < 1) {
      throw new Error(`${found.definition.name}: bad reps`);
    }
    if (typeof weight !== 'number' || !Number.isFinite(weight)) {
      throw new Error(`${found.definition.name}: bad weight`);
    }

    exercises.push({
      name: found.definition.name,
      // Snapped rather than rejected: the ladder is the authority, and being a
      // rung out is a rounding slip rather than a misunderstanding.
      weightLb: snapToRung(found.ladder, weight),
      sets: Math.round(sets),
      reps: Math.round(reps),
      format: raw.format === 'complex' || raw.format === 'density' ? raw.format : 'straight',
      instructions:
        typeof raw.instructions === 'string'
          ? raw.instructions.trim().slice(0, 600)
          : (found.definition.cue ?? ''),
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
  if (candidates.length === 0) throw new Error(`nothing in the pool for ${type}`);

  const prompt = buildPrompt(type, policy, candidates);

  const parsed = await serialise(async () => {
    try {
      return parse(await run(prompt), candidates);
    } catch (first) {
      // One retry — a malformed reply is usually a one-off, and twice in a row
      // is a real problem that shouldn't cost another two minutes.
      if (first instanceof Error && first.message === 'the planner did not respond') throw first;
      return parse(await run(prompt), candidates);
    }
  });

  const exercises: SessionExercise[] = parsed.exercises.map((planned) => {
    const definition = candidates.find(
      (candidate) => candidate.definition.name === planned.name,
    )!.definition;

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
