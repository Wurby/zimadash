/**
 * The calorie tracker's wire types, shared by both sides.
 *
 * Field values are a bag keyed by field id rather than named properties,
 * because the tracked set is user-extensible — you can add "added sugars"
 * tomorrow and every entry from then on carries it. Entries logged before that
 * simply have no key for it, which is the difference between *unknown* and
 * *zero* and is what lets a graph start where its data does.
 */

/** Fields that always exist and can never be removed. */
export const CORE_FIELDS = ['calories', 'protein', 'fat', 'carbs', 'fibre'] as const;

/**
 * The colors a field can be given. Generated, not hand-picked.
 *
 * Every one clears 3:1 against **both** the light and the dark surface, which
 * is a far narrower lightness window than either theme's band implies, and no
 * two are within ΔE 11 of each other.
 *
 * They also carry a chroma floor, which is what fixes telling them apart in
 * light mode. A dull color on a dark surface still reads as a color because it
 * is so much lighter than its background; the same color on near-white reads as
 * mud, and several muds look alike. Cyan, olive and amber are absent for that
 * reason — sRGB cannot make them vivid *and* dark enough to hold contrast on
 * white, and relaxing the contrast floor to 2.3:1 was measured to buy almost
 * nothing (chroma 0.105 → 0.116), so they were cut instead.
 *
 * Eleven is near the ceiling: requiring every pair to be distinguishable
 * *within one plot* (ΔE 15) allows only nine. That stricter bar isn't needed
 * here because each field owns its own chart and every swatch is drawn beside
 * its label. The one place colors do sit side by side is the macro breakdown on
 * the calories bar, and those three defaults are held to it.
 *
 * Ordered around the wheel so the picker reads as a spectrum.
 */
export const SWATCHES = [
  '#f75221',
  '#ac5116',
  '#3b7413',
  '#23a12f',
  '#2393dd',
  '#1260d8',
  '#9778f7',
  '#9821dc',
  '#e02cf1',
  '#f830a2',
  '#bf1e7b',
] as const;

export type CoreFieldId = (typeof CORE_FIELDS)[number];

export interface FieldConfig {
  id: string;
  /** Shown in the UI. Free text — the user names their own fields. */
  label: string;
  /** Free text: "g", "mg", "grams", whatever they type. Calories has none. */
  unit: string;
  /** Any hue. A tool's data colors are exempt from the slate/sky rule. */
  color: string;
  /** Core fields cannot be deleted or renamed. */
  core: boolean;
  /** Off keeps the history and stops asking the brain for it. */
  tracked: boolean;
  /** Optional. Drawn as a reference line on this field's graph. */
  goal: number | null;
  /** Show on the homepage tile. */
  onTile: boolean;
  /** Promote this field's graph onto the tool's main tab. */
  onMain: boolean;
}

export interface Settings {
  version: number;
  fields: FieldConfig[];
  weight: WeightSettings;
}

/** A logged meal. Values are keyed by field id; a missing key means unknown. */
export interface Entry {
  id: string;
  /** Epoch ms, stamped by the server. */
  at: number;
  /** What was typed, or a short name for a hand-entered number. */
  description: string;
  values: Record<string, number>;
  /** What the brain said it assumed. Absent for hand-entered numbers. */
  assumptions?: string;
  /** The brain's raw reply, kept so history can be re-estimated later. */
  raw?: string;
  /** True once a human has overwritten the numbers. */
  edited?: boolean;
}

/** An estimate awaiting approval. Lives in server memory, not on disk. */
export interface PendingEstimate {
  id: string;
  description: string;
  values: Record<string, number>;
  assumptions: string;
  /** How many refinement rounds this thread has been through. */
  rounds: number;
}

export interface DaySummary {
  /** The 4am-rollover day this covers, as YYYY-MM-DD. */
  date: string;
  totals: Record<string, number>;
  entries: Entry[];
}

// ─── Weight and the adaptive target ──────────────────────────────────────────

export type LossRate = 1 | 1.5 | 2;

export interface WeightSettings {
  /** Pounds. Null until you set one. */
  goalLb: number | null;
  rateLbPerWeek: LossRate;
  /** Use the learned target instead of the hand-set calorie goal. */
  useComputedTarget: boolean;
  /** Show the weight bar on the homepage tile. */
  onTile: boolean;
  /**
   * Everything before this date is ignored by the expenditure maths — and only
   * by that. Nothing is deleted; the graphs still show the full span.
   */
  baselineDate: string | null;
}

/** One morning's weigh-in. At most one per day; a later reading replaces it. */
export interface WeightReading {
  date: string;
  lb: number;
}

/** What the tool has worked out. Absent fields mean it isn't sure yet. */
export interface Expenditure {
  status: 'learning' | 'ready';
  /** How many more days of paired food-and-weight data it wants. */
  daysNeeded: number;
  /** kcal burned per day, from actual intake against actual trend movement. */
  tdee: number | null;
  /** kcal to eat per day to move at the chosen rate. */
  target: number | null;
  /** Smoothed weight, not this morning's number. */
  trendLb: number | null;
  /** Pounds per week; negative is losing. */
  ratePerWeek: number | null;
  /** True once the trend has reached the goal — the target holds steady. */
  atGoal: boolean;
  /** When the goal would arrive at the current rate. */
  projectedDate: string | null;
  /** Days dropped as under-logged, so the number isn't silently wrong. */
  excluded: number;
}

export type RangeKey = 'week' | 'fortnight' | 'month' | 'quarter' | 'half' | 'year';

export const RANGE_DAYS: Record<RangeKey, number> = {
  week: 7,
  fortnight: 14,
  month: 30,
  quarter: 91,
  half: 182,
  year: 365,
};

export const RANGE_LABELS: Record<RangeKey, string> = {
  week: 'Week',
  fortnight: '2 weeks',
  month: 'Month',
  quarter: 'Quarter',
  half: 'Half year',
  year: 'Year',
};
