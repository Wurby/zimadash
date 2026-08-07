import { readJson, writeJson } from '../../paths.js';
import { CORE_FIELDS, type FieldConfig, type Settings } from '../../shared/calories.js';

/**
 * What the tracker tracks.
 *
 * Five core fields always exist and can't be removed or renamed. Everything
 * else is the user's — their name, their unit, their color — and every tracked
 * field is required of the brain, so adding one changes what the estimate has
 * to come back with.
 */

const FILE = 'calories/settings.json';
const VERSION = 1;

/**
 * Protein, fat and carbs are the three that sit side by side in the calories
 * bar, so they are picked for separation under the strict single-plot bar —
 * ΔE 27 in normal vision, 11 under protanopia — rather than just for looks.
 */
const CORE_DEFAULTS: Array<Pick<FieldConfig, 'id' | 'label' | 'unit' | 'color'>> = [
  { id: 'calories', label: 'Calories', unit: 'kcal', color: '#9821dc' },
  { id: 'protein', label: 'Protein', unit: 'g', color: '#f830a2' },
  { id: 'fat', label: 'Fat', unit: 'g', color: '#f75221' },
  { id: 'carbs', label: 'Carbs', unit: 'g', color: '#1260d8' },
  { id: 'fibre', label: 'Fibre', unit: 'g', color: '#23a12f' },
];

function defaults(): Settings {
  return {
    version: VERSION,
    fields: CORE_DEFAULTS.map((field) => ({
      ...field,
      core: true,
      tracked: true,
      goal: null,
      // The tile defaults to calories and macros — everything core except
      // fibre, which is the one people add a goal for rather than watch.
      onTile: field.id !== 'fibre',
      onMain: field.id === 'calories',
    })),
  };
}

function migrate(raw: unknown): Settings {
  const stored = raw as Partial<Settings> | null;
  if (!stored || !Array.isArray(stored.fields)) return defaults();

  // A core field must exist even if an old file predates it, or the brain would
  // stop being asked for something the UI assumes is always there.
  const byId = new Map(stored.fields.map((field) => [field.id, field]));
  const merged = defaults().fields.map((base) => ({ ...base, ...byId.get(base.id), core: true }));
  const custom = stored.fields.filter((field) => !CORE_FIELDS.includes(field.id as never));

  return { version: VERSION, fields: [...merged, ...custom.map((f) => ({ ...f, core: false }))] };
}

export function readSettings(): Settings {
  return migrate(readJson<Settings>(FILE));
}

export function writeSettings(settings: Settings): Settings {
  const safe = migrate(settings);
  writeJson(FILE, safe);
  return safe;
}

/** The fields an estimate must come back with. */
export function trackedFields(): FieldConfig[] {
  return readSettings().fields.filter((field) => field.tracked);
}

export function isCoreField(id: string): boolean {
  return CORE_FIELDS.includes(id as never);
}
