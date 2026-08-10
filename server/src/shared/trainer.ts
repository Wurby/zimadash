/**
 * Personal trainer — types and the maths, imported by BOTH sides.
 *
 * Keep this free of Node built-ins and browser globals; the frontend reaches it
 * through the `@shared/*` alias.
 *
 * The governing idea: **the equipment you own generates everything else.** Every
 * achievable load is derived from the inventory, so nothing here hardcodes a
 * weight and the day a heavier pair arrives the whole ladder regrows itself.
 */

export const DAY_MS = 86_400_000;

// ─── Equipment ───────────────────────────────────────────────────────────────

/**
 * How a movement is loaded. This is the reason there is no single ladder: a bar
 * lift carries the bar's own weight, the bench's leg attachment takes plates
 * without it, and dumbbell work depends on which pairs exist and how many hands
 * are on them.
 */
export type Implement =
  | 'bar' // EZ bar + plates on both sides
  | 'plates' // plates only — the leg attachment
  | 'dumbbell-pair' // one in each hand, or both held together
  | 'dumbbell-single' // one dumbbell, one or two hands
  | 'bodyweight' // no load
  | 'bodyweight-plus'; // bodyweight with an optional dumbbell added

export const IMPLEMENTS: Implement[] = [
  'bar',
  'plates',
  'dumbbell-pair',
  'dumbbell-single',
  'bodyweight',
  'bodyweight-plus',
];

export interface PlatePair {
  /** Weight of ONE plate. They are bought and loaded in pairs. */
  lb: number;
  /** How many pairs of this weight you own. */
  pairs: number;
}

export interface DumbbellPair {
  lb: number;
  pairs: number;
}

export interface Inventory {
  /** Weight of the bar itself. Zero if there isn't one. */
  barLb: number;
  plates: PlatePair[];
  dumbbells: DumbbellPair[];
}

/** Every distinct total reachable by loading some subset of the pairs. */
function pairSums(pairs: { lb: number; pairs: number }[]): number[] {
  // Each pair contributes 2x its plate weight, and you may use 0..n of them.
  let totals = new Set<number>([0]);

  for (const { lb, pairs: count } of pairs) {
    const next = new Set<number>();
    for (const running of totals) {
      for (let used = 0; used <= count; used += 1) {
        next.add(running + used * lb * 2);
      }
    }
    totals = next;
  }

  return [...totals].sort((a, b) => a - b);
}

/** Every distinct weight of a single dumbbell you could pick up. */
function singleDumbbells(dumbbells: DumbbellPair[]): number[] {
  const weights = new Set<number>();
  for (const { lb, pairs } of dumbbells) {
    if (pairs > 0) weights.add(lb);
  }
  return [...weights].sort((a, b) => a - b);
}

/**
 * The loads available for a given implement, ascending.
 *
 * **This is computed, never written down.** A literal list of weights would look
 * right today and silently freeze the first time the inventory changes, which is
 * the one thing this design exists to prevent.
 */
export function loadLadder(inventory: Inventory, implement: Implement): number[] {
  // Zero is only a real rung where the movement works unloaded. On a loaded
  // implement it means "pick up nothing", which is not a lighter goblet squat —
  // it's not a goblet squat. Backing off two rungs from the bottom found this.
  const loaded = (weights: number[]) => weights.filter((weight) => weight > 0);

  switch (implement) {
    case 'bar':
      // The bar alone is a legitimate bottom rung, so this one keeps its floor.
      return pairSums(inventory.plates).map((plates) => plates + inventory.barLb);
    case 'plates':
      return loaded(pairSums(inventory.plates));
    case 'dumbbell-pair':
      // Both hands loaded, or both held together for a goblet squat — either way
      // the figure that gets logged is the total.
      return loaded(pairSums(inventory.dumbbells));
    case 'dumbbell-single':
      return loaded(singleDumbbells(inventory.dumbbells));
    case 'bodyweight':
      return [0];
    case 'bodyweight-plus':
      // Bodyweight is the floor and a single dumbbell is how it gets harder —
      // a hip thrust holds one across the hips, it doesn't hold a pair.
      return [0, ...loaded(singleDumbbells(inventory.dumbbells))];
    default:
      return [0];
  }
}

/** The nearest rung to an arbitrary weight — what an imported or typed figure
 *  gets held to. */
export function snapToRung(ladder: number[], weight: number): number {
  if (ladder.length === 0) return weight;
  return ladder.reduce((best, rung) =>
    Math.abs(rung - weight) < Math.abs(best - weight) ? rung : best,
  );
}

/** Where a weight sits on the ladder. -1 if it isn't on it at all. */
export function rungOf(ladder: number[], weight: number): number {
  return ladder.indexOf(weight);
}

/** How many rungs remain above a weight — the "runway" before the equipment
 *  itself is the limit. */
export function rungsRemaining(ladder: number[], weight: number): number {
  const index = rungOf(ladder, snapToRung(ladder, weight));
  return index < 0 ? 0 : ladder.length - 1 - index;
}

// ─── The exercise catalogue ──────────────────────────────────────────────────

export type SessionType = 'Upper A' | 'Lower' | 'Upper B';

export interface ExerciseDef {
  name: string;
  implement: Implement;
  kind: 'compound' | 'accessory';
  /** Which day types it can appear on. */
  days: SessionType[];
  /**
   * Carries the knee protocol: a harder back-off when it's too much, and its
   * own cueing. Set from the brief, not guessed per session.
   */
  kneeLoaded?: boolean;
  /** Chains two movements into one set — counts as one slot, takes longer. */
  complex?: boolean;
  /** Other names this goes by, so an imported log matches. */
  aliases?: string[];
  /**
   * How to perform it — shown on the exercise screen and read aloud.
   *
   * Deliberately separate from `note`. They were one field until voice mode
   * read "rotate this with flat bench rather than running both in one session"
   * out loud mid-set: true, useful when *building* a session, and nonsense when
   * you are stood holding the dumbbells.
   */
  cue?: string;
  /** Context for choosing it. Never spoken. */
  note?: string;
}

/** Loose match for an imported name — case, spacing and shorthand all vary. */
export function findExercise(catalogue: ExerciseDef[], name: string): ExerciseDef | null {
  const key = name.trim().toLowerCase();
  return (
    catalogue.find((exercise) => exercise.name.toLowerCase() === key) ??
    catalogue.find((exercise) => exercise.aliases?.some((alias) => alias.toLowerCase() === key)) ??
    null
  );
}

// ─── The rating scale ────────────────────────────────────────────────────────

/**
 * Four words, and "Hard" is the target — a working set should feel hard, so
 * naming the target "just right" would be smoothing something that doesn't need
 * it.
 */
export type Rating = 'too-easy' | 'easy' | 'hard' | 'too-hard';

export const RATINGS: Rating[] = ['too-easy', 'easy', 'hard', 'too-hard'];

export interface RatingMeta {
  label: string;
  /** What it does to next time, in the user's words. */
  consequence: string;
  /** Rungs to move. Negative drops. */
  rungs: number;
  /**
   * The old 0–10 scale's equivalent, kept as the stored record so imported
   * history stays comparable and a finer scale could return without a
   * migration.
   */
  canonical: number;
}

export const RATING_META: Record<Rating, RatingMeta> = {
  'too-easy': { label: 'Too easy', consequence: 'up two', rungs: 2, canonical: 1 },
  easy: { label: 'Easy', consequence: 'up one', rungs: 1, canonical: 3.5 },
  hard: { label: 'Hard', consequence: 'stay here', rungs: 0, canonical: 6.5 },
  'too-hard': { label: 'Too hard', consequence: 'down one', rungs: -1, canonical: 9.5 },
};

/** The target rating — what you're aiming to feel. */
export const TARGET_RATING: Rating = 'hard';

/** Map an old 0–10 figure onto the four-point scale, for importing history. */
export function ratingFromCanonical(value: number): Rating {
  let best: Rating = 'hard';
  let closest = Infinity;
  for (const rating of RATINGS) {
    const distance = Math.abs(RATING_META[rating].canonical - value);
    if (distance < closest) {
      closest = distance;
      best = rating;
    }
  }
  return best;
}

export interface Prescription {
  weightLb: number;
  sets: number;
  reps: number;
}

export interface NextUp extends Prescription {
  /** Why it moved, in a phrase — shown so the suggestion is never mysterious. */
  because: string;
}

/**
 * What to do next time, given how the last one felt.
 *
 * Two rules from the brief live here rather than in a prompt, because they are
 * arithmetic and the model shouldn't be trusted with arithmetic:
 *
 * - **Knee-loaded work drops two rungs, not one.** The brief is explicit that an
 *   over-hard squat or leg movement backs off harder than anything else.
 * - **At the ceiling, reps are the lever.** Once a lift is on the top rung there
 *   is no more weight to add, and the brief says reps should climb rather than
 *   stall — so "Easy" adds reps instead of failing to add load.
 */
export function nextPrescription(
  last: Prescription,
  rating: Rating,
  ladder: number[],
  options: { kneeLoaded?: boolean } = {},
): NextUp {
  const meta = RATING_META[rating];
  const current = snapToRung(ladder, last.weightLb);
  const index = rungOf(ladder, current);

  if (meta.rungs === 0) {
    return { ...last, weightLb: current, because: 'held — this is the target' };
  }

  // Backing off a knee-loaded lift goes down two, per the knee protocol.
  const step = meta.rungs < 0 && options.kneeLoaded ? -2 : meta.rungs;
  const wanted = index + step;

  if (step > 0 && index >= ladder.length - 1) {
    // Top of the ladder: the equipment is the limit, so reps climb instead.
    return {
      ...last,
      weightLb: current,
      reps: last.reps + (rating === 'too-easy' ? 2 : 1),
      because: 'at the equipment ceiling — reps up instead',
    };
  }

  const clamped = Math.max(0, Math.min(ladder.length - 1, wanted));
  const weightLb = ladder[clamped] ?? current;
  const moved = clamped - index;

  if (moved === 0) {
    return { ...last, weightLb, because: 'already at the bottom of the ladder' };
  }

  return {
    ...last,
    weightLb,
    because:
      moved > 0
        ? `up ${moved} rung${moved === 1 ? '' : 's'}`
        : `down ${-moved} rung${moved === -1 ? '' : 's'}${options.kneeLoaded ? ' (knee)' : ''}`,
  };
}

// ─── Sessions ────────────────────────────────────────────────────────────────

/** The rotation, in order. Lower falls between both upper days. */
export const ROTATION: SessionType[] = ['Upper A', 'Lower', 'Upper B', 'Lower'];

/** What comes after the last session that was actually done. */
export function nextSessionType(history: { type: SessionType }[]): SessionType {
  if (history.length === 0) return ROTATION[0]!;

  const last = history[history.length - 1]!.type;

  // Lower appears twice, so "the one after Lower" depends on which Lower it was
  // — look back for the most recent upper day to disambiguate.
  if (last === 'Lower') {
    for (let i = history.length - 2; i >= 0; i -= 1) {
      const type = history[i]!.type;
      if (type === 'Upper A') return 'Upper B';
      if (type === 'Upper B') return 'Upper A';
    }
    return 'Upper A';
  }

  return 'Lower';
}

export type SessionStatus = 'planned' | 'active' | 'done';

export interface SetResult {
  weightLb: number;
  sets: number;
  reps: number;
  rating: Rating;
  /** Free text — what was odd about it. */
  note?: string;
  /** True when it was swapped out or skipped rather than performed. */
  skipped?: boolean;
  skipReason?: string;
}

export interface SessionExercise {
  name: string;
  implement: Implement;
  kneeLoaded?: boolean;
  /** 'straight' unless the brief's other formats are in play. */
  format?: 'straight' | 'complex' | 'density';
  prescribed: Prescription;
  /** Written by the model and stored, so History replays what you were told. */
  instructions?: string;
  result: SetResult | null;
}

export interface Session {
  id: string;
  /** YYYY-MM-DD, local. */
  date: string;
  type: SessionType;
  status: SessionStatus;
  /** Which exercise you're on, while active. */
  cursor: number;
  exercises: SessionExercise[];
  /** Where the plan came from, so a rules-built session is never mistaken for a
   *  considered one. */
  plannedBy: 'model' | 'rules' | 'import';
  startedAt?: number;
  finishedAt?: number;
  /** Anything the importer couldn't parse cleanly, kept verbatim. */
  importNotes?: string[];
}

// ─── Detailed guidance ───────────────────────────────────────────────────────

/**
 * The long-form how-to for one movement.
 *
 * Kept apart from a session's `instructions`, which are the short cue for
 * *today* and reference today's load. This is a property of the exercise, so it
 * is generated once and reused — the goblet squat is performed the same way in
 * March as in August.
 */
export interface ExerciseGuide {
  exercise: string;
  setup: string;
  steps: string[];
  watchFor: string[];
  /** Regenerated when the brief changes, since the brief shapes the cueing. */
  policyHash: string;
  at: number;
}

/** Read aloud, when voice is on and you've asked for the detail. */
export function spokenGuide(guide: ExerciseGuide): string {
  return [
    `${guide.exercise}.`,
    `Setup. ${guide.setup}`,
    ...guide.steps.map((step, index) => `Step ${index + 1}. ${step}`),
    guide.watchFor.length > 0 ? `Watch for. ${guide.watchFor.join(' ')}` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

// ─── Speech ──────────────────────────────────────────────────────────────────

/**
 * What an exercise sounds like when it's read out.
 *
 * Shared so the sentence is identical whether it's synthesised on the server or
 * spoken by the browser — otherwise the cached audio and the fallback would
 * drift apart and the same screen would say two different things.
 */
export function spokenFor(exercise: SessionExercise, index: number, total: number): string {
  const parts = [`Exercise ${index + 1} of ${total}. ${exercise.name}.`];

  if (exercise.prescribed.weightLb > 0) {
    parts.push(`${exercise.prescribed.weightLb} pounds.`);
  } else {
    parts.push('Bodyweight.');
  }

  parts.push(`${exercise.prescribed.sets} sets of ${exercise.prescribed.reps}.`);

  // The knee protocol only gets spoken generically when the movement has
  // nothing of its own to say. Where it does, that cue already carries the
  // control cueing — saying both had the goblet squat repeat "knees over toes"
  // twice in one breath.
  if (exercise.instructions) {
    parts.push(exercise.instructions);
  } else if (exercise.kneeLoaded) {
    parts.push('Knee work — control the descent, no bouncing, knees tracking over your toes.');
  }

  return parts.join(' ');
}

// ─── Progress ────────────────────────────────────────────────────────────────

/**
 * Epley. Makes 4x6 at 45lb comparable with 3x20 at 15lb, which raw load can't.
 *
 * A comparison metric only — nothing here should ever suggest actually testing
 * a one-rep max.
 */
export function estimatedOneRepMax(weightLb: number, reps: number): number {
  if (weightLb <= 0 || reps <= 0) return 0;
  return Math.round(weightLb * (1 + reps / 30) * 10) / 10;
}

/** Total load shifted in a set result. */
export function volumeOf(result: SetResult): number {
  return result.weightLb * result.sets * result.reps;
}

export interface PersonalRecord {
  exercise: string;
  weightLb: number;
  reps: number;
  oneRepMax: number;
  date: string;
  /** What it beat, if anything. */
  previousOneRepMax: number | null;
}

/**
 * Best estimated 1RM per exercise, in the order they were set.
 *
 * Ranked on estimated 1RM rather than raw weight so a heavier-but-fewer set
 * doesn't erase a genuinely better one at a lighter load.
 */
export function personalRecords(sessions: Session[]): PersonalRecord[] {
  const done = [...sessions]
    .filter((session) => session.status === 'done')
    .sort((a, b) => a.date.localeCompare(b.date));

  const best = new Map<string, number>();
  const records: PersonalRecord[] = [];

  for (const session of done) {
    for (const exercise of session.exercises) {
      const result = exercise.result;
      if (!result || result.skipped) continue;

      const oneRepMax = estimatedOneRepMax(result.weightLb, result.reps);
      if (oneRepMax <= 0) continue;

      const previous = best.get(exercise.name) ?? null;
      if (previous !== null && oneRepMax <= previous) continue;

      best.set(exercise.name, oneRepMax);
      records.push({
        exercise: exercise.name,
        weightLb: result.weightLb,
        reps: result.reps,
        oneRepMax,
        date: session.date,
        previousOneRepMax: previous,
      });
    }
  }

  return records.reverse();
}

// ─── Habit ───────────────────────────────────────────────────────────────────

/** Sessions a week you're aiming for. */
export const WEEKLY_TARGET = 3;

/** Below this, the week doesn't count and the streak ends. Two is better than
 *  none, so two keeps it alive. */
export const WEEKLY_FLOOR = 2;

export function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function parseDay(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, day);
}

/** The Monday of a date's week, as a day key. Weeks start Monday because the
 *  target is a training week, not a calendar convenience. */
export function weekKey(iso: string): string {
  const date = parseDay(iso);
  const weekday = (date.getDay() + 6) % 7; // Monday = 0
  date.setDate(date.getDate() - weekday);
  return dayKey(date);
}

export interface DayCell {
  date: string;
  /** Null on a rest day. */
  type: SessionType | null;
  /** 0–1, how hard the session was on average. Drives the cell's intensity. */
  effort: number;
  volume: number;
}

/** One cell per day between two dates, inclusive. */
export function habitGrid(sessions: Session[], from: string, to: string): DayCell[] {
  const byDay = new Map<string, Session[]>();
  for (const session of sessions) {
    if (session.status !== 'done') continue;
    const list = byDay.get(session.date) ?? [];
    list.push(session);
    byDay.set(session.date, list);
  }

  const cells: DayCell[] = [];
  const cursor = parseDay(from);
  const end = parseDay(to);

  while (cursor <= end) {
    const key = dayKey(cursor);
    const here = byDay.get(key) ?? [];

    if (here.length === 0) {
      cells.push({ date: key, type: null, effort: 0, volume: 0 });
    } else {
      const results = here.flatMap((session) =>
        session.exercises.map((exercise) => exercise.result).filter((r): r is SetResult => !!r),
      );
      const rated = results.filter((r) => !r.skipped);
      const effort =
        rated.length === 0
          ? 0
          : rated.reduce((sum, r) => sum + RATING_META[r.rating].canonical, 0) / rated.length / 10;

      cells.push({
        date: key,
        type: here[0]!.type,
        effort: Math.min(1, Math.max(0, effort)),
        volume: rated.reduce((sum, r) => sum + volumeOf(r), 0),
      });
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  return cells;
}

export interface WeekSummary {
  week: string;
  count: number;
  /** Hit the full target. */
  full: boolean;
  /** Cleared the floor, so the streak survives. */
  kept: boolean;
}

export function weeklySummaries(sessions: Session[]): WeekSummary[] {
  const counts = new Map<string, number>();
  for (const session of sessions) {
    if (session.status !== 'done') continue;
    const key = weekKey(session.date);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([week, count]) => ({
      week,
      count,
      full: count >= WEEKLY_TARGET,
      kept: count >= WEEKLY_FLOOR,
    }));
}

/**
 * Consecutive weeks that cleared the floor, counting back from the current one.
 *
 * The week in progress never breaks the streak — you might still train on
 * Friday — so it only counts once it has cleared the floor.
 */
export function currentStreak(sessions: Session[], today: string): number {
  const summaries = new Map(weeklySummaries(sessions).map((week) => [week.week, week]));
  let streak = 0;
  const cursor = parseDay(weekKey(today));

  // Skip the in-progress week unless it has already been kept.
  const thisWeek = summaries.get(dayKey(cursor));
  if (thisWeek?.kept) streak += 1;

  for (;;) {
    cursor.setDate(cursor.getDate() - 7);
    const week = summaries.get(dayKey(cursor));
    if (!week?.kept) break;
    streak += 1;
  }

  return streak;
}
