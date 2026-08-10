/**
 * Last time I… — types and the interval maths, imported by BOTH sides.
 *
 * Keep this free of Node built-ins and browser globals; the frontend reaches it
 * through the `@shared/*` alias.
 */

export const DAY_MS = 86_400_000;

/** How many taps before a learned interval is trustworthy. */
const MIN_TAPS_TO_LEARN = 3;

/** Only the recent past feeds the median — a habit you've since changed
 *  shouldn't be argued for by a gap from a year ago. */
const GAPS_CONSIDERED = 6;

export interface LastTimeItem {
  id: string;
  label: string;
  /** The interval to assume before there is enough history to learn one. */
  defaultDays: number;
  /** Pinned by hand. Beats both the learned figure and the default. */
  overrideDays: number | null;
  /** Whether it shows on the dashboard tile. */
  onTile: boolean;
  /** Every tap, oldest first. */
  history: number[];
}

export interface LastTimeFile {
  items: LastTimeItem[];
}

/** Which of the three intervals ended up in play. */
export type IntervalSource = 'override' | 'learned' | 'default';

/** How overdue something is. Three states rather than a raw ratio, because
 *  this has to be readable from across a room. */
export type Age = 'fresh' | 'due' | 'overdue';

/** An item with everything derived, so the browser never recomputes it. */
export interface ItemView {
  id: string;
  label: string;
  onTile: boolean;
  defaultDays: number;
  overrideDays: number | null;
  /** The median recent gap, once there are enough taps to mean anything. */
  learnedDays: number | null;
  /** What the bar is actually measured against. */
  intervalDays: number;
  source: IntervalSource;
  lastAt: number | null;
  elapsedDays: number | null;
  age: Age;
  taps: number;
}

export const MAX_LABEL = 60;
export const MAX_ITEMS = 40;
export const MIN_INTERVAL_DAYS = 0.25;
export const MAX_INTERVAL_DAYS = 3_650;
export const DEFAULT_INTERVAL_DAYS = 30;

/** How much of the interval has to elapse before it reads as due rather than
 *  fine. */
const DUE_AT = 0.75;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The interval this item's own history suggests.
 *
 * The median rather than the mean, because one holiday-shaped gap shouldn't
 * drag the whole figure out. Null until there are enough taps — a single gap is
 * a sample of one and would make the bar lurch on the second tap.
 */
export function learnedIntervalDays(history: number[]): number | null {
  if (history.length < MIN_TAPS_TO_LEARN) return null;

  const sorted = [...history].sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i += 1) {
    gaps.push((sorted[i]! - sorted[i - 1]!) / DAY_MS);
  }

  const recent = gaps.slice(-GAPS_CONSIDERED).filter((gap) => gap > 0);
  if (recent.length === 0) return null;

  return Math.round(median(recent) * 10) / 10;
}

/**
 * Which interval wins.
 *
 * A pinned value beats everything — that is what pinning is for. Failing that,
 * what you actually do beats what you guessed you'd do when you created the
 * item. The configured default is only the answer until history has an opinion.
 */
export function resolveInterval(item: LastTimeItem): {
  intervalDays: number;
  learnedDays: number | null;
  source: IntervalSource;
} {
  const learned = learnedIntervalDays(item.history);

  if (item.overrideDays !== null && item.overrideDays !== undefined) {
    return { intervalDays: item.overrideDays, learnedDays: learned, source: 'override' };
  }
  if (learned !== null) {
    return { intervalDays: learned, learnedDays: learned, source: 'learned' };
  }
  return { intervalDays: item.defaultDays, learnedDays: null, source: 'default' };
}

export function ageOf(elapsedDays: number | null, intervalDays: number): Age {
  // Never tapped is overdue by definition — that is the state that most wants
  // your attention, and a bar that reads "fine" because there's no data would
  // be lying.
  if (elapsedDays === null) return 'overdue';
  if (intervalDays <= 0) return 'fresh';

  const ratio = elapsedDays / intervalDays;
  if (ratio >= 1) return 'overdue';
  if (ratio >= DUE_AT) return 'due';
  return 'fresh';
}

export function viewOf(item: LastTimeItem, now: number): ItemView {
  const { intervalDays, learnedDays, source } = resolveInterval(item);
  const lastAt = item.history.length > 0 ? Math.max(...item.history) : null;
  const elapsedDays = lastAt === null ? null : (now - lastAt) / DAY_MS;

  return {
    id: item.id,
    label: item.label,
    onTile: item.onTile,
    defaultDays: item.defaultDays,
    overrideDays: item.overrideDays,
    learnedDays,
    intervalDays,
    source,
    lastAt,
    elapsedDays,
    age: ageOf(elapsedDays, intervalDays),
    taps: item.history.length,
  };
}

/** "3 days", "5 weeks", "never" — a short elapsed figure for a small tile. */
export function humanElapsed(elapsedDays: number | null): string {
  if (elapsedDays === null) return 'never';
  if (elapsedDays < 1 / 24) return 'just now';
  if (elapsedDays < 1) {
    const hours = Math.max(1, Math.round(elapsedDays * 24));
    return `${hours}h`;
  }

  const days = Math.round(elapsedDays);
  if (days < 14) return `${days}d`;
  if (days < 70) return `${Math.round(days / 7)}w`;
  if (days < 730) return `${Math.round(days / 30.44)}mo`;
  return `${Math.round(days / 365.25)}y`;
}

/** "every 30 days", "every 6 weeks" — the interval, in the units it reads best
 *  in. */
export function humanInterval(days: number): string {
  if (days < 1) return `every ${Math.round(days * 24)}h`;
  if (days < 14) return `every ${Math.round(days)}d`;
  if (days < 70) return `every ${Math.round(days / 7)}w`;
  return `every ${Math.round(days / 30.44)}mo`;
}
