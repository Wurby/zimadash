import {
  KCAL_PER_LB,
  type Expenditure,
  type LossRate,
  type WeightReading,
  type WeightSettings,
} from '../../shared/calories.js';

/**
 * Working out what you actually burn, and what to eat.
 *
 * The load-bearing decision: expenditure comes from **actual logged intake**
 * against **actual trend-weight movement**, never from the target. Eat 2,800
 * against a 2,200 target and this reads "burns 2,800, lost nothing" and holds
 * the target where it is — you simply lose slower. Overeating cannot drag the
 * number down.
 *
 * Under-logging can, which is why days that look incomplete are dropped. Forget
 * a 400-calorie snack every day and the naive maths sees low intake with no
 * loss, concludes a low burn, and lowers your target — which you then also
 * under-log against. That is the spiral worth defending against, and it is a
 * different problem from eating too much.
 */

/** Paired days of food and weight before it will commit to a number. */
const MIN_DAYS = 7;

/** How far back to look. Long enough to be stable, short enough to notice. */
const WINDOW_DAYS = 28;

/**
 * Smoothing for the trend. A morning weight swings pounds on water alone, so
 * the raw number is nearly useless for a rate; 0.25 keeps roughly a week of
 * history in view without lagging a real change by a fortnight.
 */
const ALPHA = 0.25;

/** Below this many days there is no distribution worth reasoning about. */
const OUTLIER_MIN_SAMPLE = 10;

/**
 * At MIN_DAYS the TDEE estimate is still noisy, so applying the full selected
 * deficit immediately can land on an unrealistically aggressive target (e.g.
 * 1200 kcal or lower). Instead the applied rate ramps from a quarter of the
 * selected rate at MIN_DAYS up to the full rate by WINDOW_DAYS. The climb
 * front-loads on sqrt() rather than going linearly, because each early paired
 * day cuts the uncertainty in the TDEE estimate faster than a later one does.
 */
const MIN_CONFIDENCE_FRACTION = 0.25;

function confidenceScaledRate(rateLbPerWeek: LossRate, pairedDays: number): number {
  const progress = (pairedDays - MIN_DAYS) / (WINDOW_DAYS - MIN_DAYS);
  const confidence = Math.sqrt(Math.min(1, Math.max(0, progress)));
  const fraction = MIN_CONFIDENCE_FRACTION + (1 - MIN_CONFIDENCE_FRACTION) * confidence;
  return rateLbPerWeek * fraction;
}

const pad = (n: number): string => String(n).padStart(2, '0');

function addDays(dayKey: string, days: number): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  const date = new Date(y, m - 1, d, 12);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function daysBetween(from: string, to: string): number {
  const parse = (key: string) => {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d, 12).getTime();
  };
  return Math.round((parse(to) - parse(from)) / 86_400_000);
}

/** Exponentially weighted trend over readings, oldest first. */
export function trendSeries(readings: WeightReading[]): WeightReading[] {
  const sorted = [...readings].sort((a, b) => a.date.localeCompare(b.date));
  let value: number | null = null;

  return sorted.map((reading) => {
    value = value === null ? reading.lb : ALPHA * reading.lb + (1 - ALPHA) * value;
    return { date: reading.date, lb: Math.round(value * 100) / 100 };
  });
}

/**
 * Days whose logged intake is implausibly low for you — more than two standard
 * deviations under your own average. Downward only: over-logging isn't a thing
 * people do, forgetting is. Before there is enough data to have a distribution,
 * anything under half the average is treated as incomplete.
 */
function underLogged(intakes: number[]): (kcal: number) => boolean {
  if (intakes.length === 0) return () => false;

  const mean = intakes.reduce((sum, value) => sum + value, 0) / intakes.length;
  if (intakes.length < OUTLIER_MIN_SAMPLE) return (kcal) => kcal < mean * 0.5;

  const variance = intakes.reduce((sum, value) => sum + (value - mean) ** 2, 0) / intakes.length;
  const floor = mean - 2 * Math.sqrt(variance);
  return (kcal) => kcal < floor;
}

export function computeExpenditure(
  intakeByDay: Map<string, number>,
  readings: WeightReading[],
  settings: WeightSettings,
  today: string,
): Expenditure {
  const empty: Expenditure = {
    status: 'learning',
    daysNeeded: MIN_DAYS,
    tdee: null,
    target: null,
    trendLb: null,
    ratePerWeek: null,
    atGoal: false,
    projectedDate: null,
    excluded: 0,
  };

  // The baseline only limits what the maths looks at. Nothing is deleted, and
  // the graphs elsewhere still show everything.
  const floorDate = settings.baselineDate ?? addDays(today, -WINDOW_DAYS);
  const from = floorDate > addDays(today, -WINDOW_DAYS) ? floorDate : addDays(today, -WINDOW_DAYS);

  const inWindow = readings.filter((r) => r.date >= from && r.date <= today);
  const trend = trendSeries(inWindow);
  const latestTrend = trend[trend.length - 1]?.lb ?? null;

  // Only days with both a weigh-in and food logged are evidence of anything.
  const paired = trend.filter((point) => intakeByDay.has(point.date));
  if (paired.length < MIN_DAYS || trend.length < 2) {
    return { ...empty, daysNeeded: Math.max(0, MIN_DAYS - paired.length), trendLb: latestTrend };
  }

  const intakes = paired.map((point) => intakeByDay.get(point.date)!);
  const isUnderLogged = underLogged(intakes);
  const counted = intakes.filter((kcal) => !isUnderLogged(kcal));
  const excluded = intakes.length - counted.length;

  if (counted.length < MIN_DAYS) {
    return { ...empty, daysNeeded: MIN_DAYS - counted.length, trendLb: latestTrend, excluded };
  }

  const avgIntake = counted.reduce((sum, kcal) => sum + kcal, 0) / counted.length;
  const span = daysBetween(trend[0].date, trend[trend.length - 1].date);
  if (span <= 0) return { ...empty, trendLb: latestTrend, excluded };

  const changeLb = trend[trend.length - 1].lb - trend[0].lb;

  // Losing weight means the deficit is energy you burned but didn't eat, so it
  // adds to expenditure. Gaining means the opposite.
  const tdee = Math.round(avgIntake - (changeLb * KCAL_PER_LB) / span);
  const ratePerWeek = Math.round((changeLb / span) * 7 * 100) / 100;

  const goal = settings.goalLb;
  const atGoal = goal !== null && latestTrend !== null && latestTrend <= goal;

  // At goal it holds steady rather than carrying on cutting. Otherwise the
  // deficit is scaled by how much paired data backs the TDEE estimate.
  const rate =
    atGoal || goal === null ? 0 : confidenceScaledRate(settings.rateLbPerWeek, counted.length);
  const target = Math.round(tdee - (rate * KCAL_PER_LB) / 7);

  let projectedDate: string | null = null;
  if (goal !== null && latestTrend !== null && !atGoal && rate > 0) {
    projectedDate = addDays(today, Math.ceil(((latestTrend - goal) / rate) * 7));
  }

  return {
    status: 'ready',
    daysNeeded: 0,
    tdee,
    target,
    trendLb: latestTrend,
    ratePerWeek,
    atGoal,
    projectedDate,
    excluded,
  };
}
