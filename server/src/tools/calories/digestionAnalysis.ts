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
 * just by being on the plate constantly. A floor of five servings keeps a
 * single coincidence from reading as a 100% suspect.
 */

const MIN_TIMES = 5;
const TOP_N = 12;

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

function rankSuspects(times: Map<string, number>, matches: Map<string, number>): Suspect[] {
  return [...times.entries()]
    .filter(([, n]) => n >= MIN_TIMES)
    .map(([food, n]) => {
      const hit = matches.get(food) ?? 0;
      return { food, times: n, matches: hit, rate: hit / n };
    })
    .sort((a, b) => b.rate - a.rate || b.times - a.times)
    .slice(0, TOP_N);
}

export function computeSuspects(meals: Entry[], episodes: DigestionEntry[]): Suspects {
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
    sameDay: rankSuspects(times, matchesSame),
    nextDay: rankSuspects(times, matchesNext),
    twoDaysOut: rankSuspects(times, matchesTwo),
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
 *  the bars read as a shape, not a number you have to parse. */
export function computePatterns(episodes: DigestionEntry[]): DigestionPatterns {
  const weekday = [0, 0, 0, 0, 0, 0, 0];
  const daypart = [0, 0, 0, 0];

  for (const episode of episodes) {
    const day = dayKeyFromMs(episode.at);
    const [y, m, d] = day.split('-').map(Number);
    const weekdayIndex = new Date(y, m - 1, d, 12).getDay();
    weekday[weekdayIndex] += 1;
    daypart[daypartOf(new Date(episode.at).getHours())] += 1;
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
