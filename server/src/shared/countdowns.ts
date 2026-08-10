/**
 * Countdowns — types and the date maths, imported by BOTH sides.
 *
 * Keep this free of Node built-ins and browser globals; the frontend reaches it
 * through the `@shared/*` alias.
 */

export const DAY_MS = 86_400_000;

/** Four is the whole feature for now — enough to be useful, few enough that
 *  they all fit on a tile without a scroll or a "+3 more". */
export const MAX_COUNTDOWNS = 4;

export const MAX_LABEL = 60;

export interface Countdown {
  id: string;
  label: string;
  /** YYYY-MM-DD. A calendar day, not an instant — "three days away" must not
   *  depend on what time it is. */
  date: string;
  /** Rolls to the same day next year once it passes. Birthdays, renewals. */
  yearly: boolean;
}

export interface CountdownsFile {
  items: Countdown[];
}

export interface CountdownView extends Countdown {
  /** Whole days from today. Negative once a one-off has passed. */
  days: number;
  /** The date being counted to — next year's, for a rolled-over yearly. */
  target: string;
  passed: boolean;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDay(iso: string): boolean {
  if (!ISO_DAY.test(iso)) return false;
  const [year, month, day] = iso.split('-').map(Number) as [number, number, number];
  const date = new Date(year, month - 1, day);
  // Round-trips only if the day actually exists — this is what rejects 31 Feb.
  return (
    date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
  );
}

/**
 * Local midnight for a YYYY-MM-DD.
 *
 * Deliberately not `new Date(iso)`, which parses a bare date as UTC and lands
 * on the previous day for anyone west of Greenwich.
 */
export function parseDay(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, day);
}

export function formatDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Today at local midnight, so day counts are calendar days. */
export function startOfDay(at: number): Date {
  const date = new Date(at);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * The date actually being counted to.
 *
 * A yearly countdown rolls forward the moment it passes, so a birthday never
 * sits at "-1 day". A one-off keeps its date and goes negative — it stays on
 * the list, counting up, until you delete it, because something that vanished
 * on its own would take the record of it having happened with it.
 */
export function nextOccurrence(item: Countdown, today: Date): Date {
  const target = parseDay(item.date);
  if (!item.yearly || target >= today) return target;

  const rolled = new Date(today.getFullYear(), target.getMonth(), target.getDate());
  if (rolled < today) rolled.setFullYear(rolled.getFullYear() + 1);
  return rolled;
}

export function viewOf(item: Countdown, now: number): CountdownView {
  const today = startOfDay(now);
  const target = nextOccurrence(item, today);
  // Both ends are local midnight, so this is a whole number of calendar days
  // even across a daylight-saving boundary — round rather than floor to absorb
  // the hour that a DST shift adds or removes.
  const days = Math.round((target.getTime() - today.getTime()) / DAY_MS);

  return { ...item, days, target: formatDay(target), passed: days < 0 };
}

/** Soonest first; anything already past sinks to the bottom in the order it
 *  went by. */
export function sortViews(views: CountdownView[]): CountdownView[] {
  return [...views].sort((a, b) => {
    if (a.passed !== b.passed) return a.passed ? 1 : -1;
    return a.days - b.days;
  });
}

/** "in 3 days", "tomorrow", "today", "6 days ago". */
export function humanDays(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  if (days < 0) return `${Math.abs(days)} days ago`;
  return `in ${days} days`;
}
