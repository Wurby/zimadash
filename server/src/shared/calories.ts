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
 * Hand-picking shades produced near-duplicates — two greens a few ΔE apart that
 * looked like the same swatch twice. These come from a hue sweep filtered to
 * only what clears **3:1 against both the light and dark surfaces**, which is a
 * far narrower lightness window than either theme band implies, and then chosen
 * greedily so no two are within ΔE 11 of each other.
 *
 * Twelve is close to the ceiling: demanding every pair be distinguishable
 * *within one plot* (ΔE 15) allows only nine, and that stricter bar isn't
 * needed here because each field owns its own chart and every swatch is drawn
 * beside its label. The one place colors do sit side by side is the macro
 * breakdown on the calories bar, and those three defaults are checked against
 * the stricter bar.
 *
 * Ordered around the wheel so the picker reads as a spectrum.
 */
export const SWATCHES = [
  '#f63e1f',
  '#a34c14',
  '#b38320',
  '#5c6c13',
  '#23a12f',
  '#2395ad',
  '#1465e3',
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
