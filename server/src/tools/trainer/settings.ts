import { personal, readJson, writeJson } from '../../paths.js';
import type { ExerciseDef, Inventory } from '../../shared/trainer.js';

/**
 * Trainer settings — the equipment, the exercise catalogue, and the policy the
 * model is briefed with.
 *
 * All three live in DATA_DIR. **The policy prose carries personal health
 * information and must never be written into this repo** — not as a default, not
 * as a fixture, not as a test. A new user starts empty and adds equipment;
 * the brain grows the catalogue from there. The real brief is typed in and
 * stays on the box.
 */

function file(): string {
  return personal('trainer/settings.json');
}

export interface TrainerSettings {
  inventory: Inventory;
  catalogue: ExerciseDef[];
  /** Free prose handed to the model alongside the session context. Empty until
   *  it's filled in from the vault. */
  policy: string;
}

export const DEFAULT_SETTINGS: TrainerSettings = {
  inventory: { barLb: 0, plates: [], dumbbells: [] },
  catalogue: [],
  policy: '',
};

export function readSettings(): TrainerSettings {
  const stored = readJson<Partial<TrainerSettings>>(file());
  if (!stored) return { ...DEFAULT_SETTINGS, inventory: { ...DEFAULT_SETTINGS.inventory } };

  return {
    inventory: stored.inventory ?? DEFAULT_SETTINGS.inventory,
    catalogue: Array.isArray(stored.catalogue) ? stored.catalogue : [],
    policy: typeof stored.policy === 'string' ? stored.policy : '',
  };
}

export function writeSettings(settings: TrainerSettings): void {
  writeJson(file(), settings);
}

/** Persist movements the brain just invented so they can repeat. */
export function rememberExercises(defs: ExerciseDef[]): void {
  if (defs.length === 0) return;
  const settings = readSettings();
  const known = new Set(settings.catalogue.map((entry) => entry.name.toLowerCase()));
  const added = defs.filter((def) => !known.has(def.name.toLowerCase()));
  if (added.length === 0) return;
  writeSettings({ ...settings, catalogue: [...settings.catalogue, ...added] });
}
