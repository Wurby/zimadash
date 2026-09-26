import type {
  DigestionDay,
  DigestionEntry,
  DigestionPatterns,
  Entry,
  Suspect,
  Suspects,
} from '../../shared/calories.js';
import { dayKeyFromMs, shiftDayKey } from '../../shared/calories.js';

/**
 * "Which foods precede an episode" — the payoff the whole tab exists for.
 *
 * v1 matches on exact strings: split a meal's description on commas, trim and
 * lowercase. No fuzzy grouping across wordings yet, so "garlic bread" and
 * "garlic" count as two different suspects — a later pass can cluster these
 * the way the Again-chip grouping already clusters meal names.
 *
 * Ranked by rate, not raw count, so a food eaten almost every day doesn't win
 * just by being on the plate constantly. Rate alone would let a food eaten
 * twice and followed twice outrank one followed 8 of 10 times, so the order
 * is the lower bound of the rate's confidence interval instead: small samples
 * sink until they've earned their spot, which is what lets a short window
 * show something without the list being led by coincidences.
 *
 * A food needs at least one match — a suspect that never preceded an episode
 * isn't one — and a number of servings that follows the Fibonacci sequence up
 * the window ladder: 1 across a week, then 1, 2, 3, 5 and 8 for two weeks, a
 * month, a quarter, half a year and a year. Rows are marked thin until they
 * clear the number two steps further up.
 */

const TOP_N = 12;

// The named windows, in days. "All" is placed on the same ladder by its length.
const LADDER = [7, 14, 30, 91, 182, 365];

/** Where a window of this many days sits on the ladder: 0 for a week, 5 for a
 *  year, fractional in between, and one more per doubling past a year. */
function ladderPosition(days: number): number {
  if (days <= LADDER[0]) return 0;
  for (let i = 1; i < LADDER.length; i += 1) {
    if (days <= LADDER[i]) {
      const from = Math.log(LADDER[i - 1]);
      return i - 1 + (Math.log(days) - from) / (Math.log(LADDER[i]) - from);
    }
  }
  return LADDER.length - 1 + Math.log2(days / LADDER[LADDER.length - 1]);
}

/** 1, 1, 2, 3, 5, 8, 13… by position, blended between whole positions so a
 *  window that sits between two rungs (the ever-growing "all") lands between
 *  their numbers rather than jumping. */
function fibonacciAt(position: number): number {
  const at = (n: number): number => {
    let [a, b] = [1, 1];
    for (let i = 0; i < n; i += 1) [a, b] = [b, a + b];
    return a;
  };
  const whole = Math.floor(position);
  return Math.round(at(whole) + (position - whole) * (at(whole + 1) - at(whole)));
}

function minTimesFor(windowDays: number): number {
  return fibonacciAt(ladderPosition(windowDays));
}

function solidTimesFor(windowDays: number): number {
  return fibonacciAt(ladderPosition(windowDays) + 2);
}

/** Wilson score lower bound, 95%. */
function lowerBound(hits: number, n: number): number {
  const z = 1.96;
  const p = hits / n;
  const centre = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
  return (centre - margin) / (1 + (z * z) / n);
}

function foodsIn(description: string): string[] {
  return [
    ...new Set(
      description
        .split(',')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

function rankSuspects(
  times: Map<string, number>,
  matches: Map<string, number>,
  minTimes: number,
): Suspect[] {
  return [...times.entries()]
    .map(([food, n]) => ({ food, n, hit: matches.get(food) ?? 0 }))
    .filter(({ n, hit }) => n >= minTimes && hit > 0)
    .sort((a, b) => lowerBound(b.hit, b.n) - lowerBound(a.hit, a.n) || b.n - a.n)
    .map(({ food, n, hit }): Suspect => ({ food, times: n, matches: hit, rate: hit / n }))
    .slice(0, TOP_N);
}

export function computeSuspects(
  meals: Entry[],
  episodes: DigestionEntry[],
  windowDays: number,
): Suspects {
  const minTimes = minTimesFor(windowDays);
  const episodesByDay = new Map<string, number[]>();
  for (const episode of episodes) {
    const day = dayKeyFromMs(episode.at);
    const list = episodesByDay.get(day) ?? [];
    list.push(episode.at);
    episodesByDay.set(day, list);
  }
  for (const list of episodesByDay.values()) list.sort((a, b) => a - b);

  const times = new Map<string, number>();
  const matchesSame = new Map<string, number>();
  const matchesNext = new Map<string, number>();
  const matchesTwo = new Map<string, number>();

  for (const meal of meals) {
    const foods = foodsIn(meal.description);
    if (foods.length === 0) continue;

    const day = dayKeyFromMs(meal.at);
    // Same-day only counts an episode that followed the meal, not one that
    // happened earlier the same day — a 6pm meal can't explain a 2pm episode.
    const sameDay = episodesByDay.get(day) ?? [];
    const followedSameDay = sameDay.some((at) => at > meal.at);
    const followedNextDay = (episodesByDay.get(shiftDayKey(day, 1)) ?? []).length > 0;
    const followedTwoDaysOut = (episodesByDay.get(shiftDayKey(day, 2)) ?? []).length > 0;

    for (const food of foods) {
      times.set(food, (times.get(food) ?? 0) + 1);
      if (followedSameDay) matchesSame.set(food, (matchesSame.get(food) ?? 0) + 1);
      if (followedNextDay) matchesNext.set(food, (matchesNext.get(food) ?? 0) + 1);
      if (followedTwoDaysOut) matchesTwo.set(food, (matchesTwo.get(food) ?? 0) + 1);
    }
  }

  return {
    minTimes,
    solidTimes: solidTimesFor(windowDays),
    sameDay: rankSuspects(times, matchesSame, minTimes),
    nextDay: rankSuspects(times, matchesNext, minTimes),
    twoDaysOut: rankSuspects(times, matchesTwo, minTimes),
  };
}

const MORNING = [5, 11];
const AFTERNOON = [12, 16];
const EVENING = [17, 20];
// Night wraps past midnight: 21:00–23:59 and 0:00–4:59.

function daypartOf(hour: number): number {
  if (hour >= MORNING[0] && hour <= MORNING[1]) return 0;
  if (hour >= AFTERNOON[0] && hour <= AFTERNOON[1]) return 1;
  if (hour >= EVENING[0] && hour <= EVENING[1]) return 2;
  return 3;
}

/** Raw counts — the client normalizes them relative to the busiest bucket so
 *  the bars read as a shape, not a number you have to parse.
 *
 * Weekday counts every episode: the day it happened is real even for
 * backfilled data, since it comes from the journal date, not a guess. Daypart
 * only counts episodes with a real clock time (`timeKnown !== false`) —
 * backfilled entries carry a made-up time-of-day (see seed-digestion.ts),
 * and counting those would just report back whatever synthetic hour was
 * chosen at import time. */
export function computePatterns(episodes: DigestionEntry[]): DigestionPatterns {
  const weekday = [0, 0, 0, 0, 0, 0, 0];
  const daypart = [0, 0, 0, 0];

  for (const episode of episodes) {
    const day = dayKeyFromMs(episode.at);
    const [y, m, d] = day.split('-').map(Number);
    const weekdayIndex = new Date(y, m - 1, d, 12).getDay();
    weekday[weekdayIndex] += 1;
    if (episode.timeKnown !== false) {
      daypart[daypartOf(new Date(episode.at).getHours())] += 1;
    }
  }

  return { weekday, daypart };
}

export function digestionDays(episodes: DigestionEntry[]): DigestionDay[] {
  const byDay = new Map<string, DigestionEntry[]>();
  for (const episode of episodes) {
    const day = dayKeyFromMs(episode.at);
    byDay.set(day, [...(byDay.get(day) ?? []), episode]);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dayEpisodes]) => ({
      date,
      count: dayEpisodes.length,
      severities: dayEpisodes.map((episode) => episode.severity),
    }));
}
