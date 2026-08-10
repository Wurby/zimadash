import { readJson, writeJson } from '../../paths.js';
import type { ExerciseDef, Inventory } from '../../shared/trainer.js';

/**
 * Trainer settings — the equipment, the exercise catalogue, and the policy the
 * model is briefed with.
 *
 * All three live in DATA_DIR. **The policy prose carries personal health
 * information and must never be written into this repo** — not as a default, not
 * as a fixture, not as a test. The seed below is deliberately empty of it; the
 * real brief is imported or typed in, and stays on the box.
 */

const FILE = 'trainer/settings.json';

export interface TrainerSettings {
  inventory: Inventory;
  catalogue: ExerciseDef[];
  /** Free prose handed to the model alongside the session context. Empty until
   *  it's filled in from the vault. */
  policy: string;
}

/**
 * The equipment as of the brief. Editable in the UI — this is only where it
 * starts, and every load ladder is derived from it, so changing a line here
 * changes every future prescription.
 */
const SEED_INVENTORY: Inventory = {
  barLb: 15,
  plates: [
    { lb: 10, pairs: 1 },
    { lb: 15, pairs: 1 },
    { lb: 25, pairs: 1 },
  ],
  dumbbells: [
    { lb: 10, pairs: 1 },
    { lb: 15, pairs: 1 },
  ],
};

/**
 * The exercise pools from the brief, as data.
 *
 * `kneeLoaded` is set here rather than inferred per session, because the knee
 * protocol is a standing fact about the movement and not a judgement call.
 */
const SEED_CATALOGUE: ExerciseDef[] = [
  // ── Upper, shared pool ──
  { name: 'Bench Press', implement: 'bar', kind: 'compound', days: ['Upper A', 'Upper B'] },
  { name: 'Bent-Over Row', implement: 'bar', kind: 'compound', days: ['Upper A', 'Upper B'] },
  { name: 'Overhead Press', implement: 'bar', kind: 'compound', days: ['Upper A', 'Upper B'] },
  { name: 'EZ Curl', implement: 'bar', kind: 'accessory', days: ['Upper A', 'Upper B'] },
  {
    name: 'Close-Grip Bench Press',
    implement: 'bar',
    kind: 'accessory',
    days: ['Upper A', 'Upper B'],
    note: 'Replaces the skull crusher, which the press-frame supports block.',
  },
  {
    name: 'Upright Row',
    implement: 'bar',
    kind: 'accessory',
    days: ['Upper A', 'Upper B'],
    note: 'Elbows catch the plates on the EZ bar mid-pull — dumbbells may suit better.',
  },
  {
    name: 'Overhead Tricep Extension',
    implement: 'dumbbell-single',
    kind: 'accessory',
    days: ['Upper A', 'Upper B'],
    aliases: ['Overhead Tricep Extension (DB, two-hand)'],
    note: 'Two hands on one dumbbell, held vertical behind the head.',
  },
  {
    name: 'Incline DB Press',
    implement: 'dumbbell-pair',
    kind: 'compound',
    days: ['Upper A', 'Upper B'],
    note: 'Rotate with flat Bench Press rather than running both in one session.',
  },
  {
    name: 'Lateral Raise',
    implement: 'dumbbell-pair',
    kind: 'accessory',
    days: ['Upper A', 'Upper B'],
    note: 'The one shoulder angle nothing else here hits.',
  },
  {
    name: 'Rear Delt Fly',
    implement: 'dumbbell-pair',
    kind: 'accessory',
    days: ['Upper A', 'Upper B'],
  },
  {
    name: 'Single-Arm DB Row',
    implement: 'dumbbell-single',
    kind: 'accessory',
    days: ['Upper A', 'Upper B'],
  },
  {
    name: 'DB Pullover',
    implement: 'dumbbell-single',
    kind: 'accessory',
    days: ['Upper A', 'Upper B'],
  },
  {
    name: 'Push-up',
    implement: 'bodyweight',
    kind: 'accessory',
    days: ['Upper A', 'Upper B'],
    note: 'Feet-elevated for more load. Becomes the main chest lever once Bench nears its ceiling.',
  },
  {
    name: 'Skull Crusher',
    implement: 'bar',
    kind: 'accessory',
    days: [],
    note: 'Retired — the bench frame supports block the movement.',
  },

  // ── Core, either day ──
  { name: 'Ab Rollout', implement: 'bodyweight', kind: 'accessory', days: ['Upper A', 'Upper B'] },

  // ── Lower ──
  {
    name: 'EZ Bar Romanian Deadlift',
    implement: 'bar',
    kind: 'compound',
    days: ['Lower'],
    aliases: ['EZ Bar RDL', 'RDL', 'Romanian Deadlift'],
    note: 'Hip-dominant and low knee stress — one of the two this day leans on.',
  },
  {
    name: 'Hip Thrust',
    implement: 'bodyweight-plus',
    kind: 'accessory',
    days: ['Lower'],
    aliases: ['Hip Thrust (box)'],
    note: 'On the box. Hold a dumbbell across the hips once bodyweight is easy.',
  },
  {
    name: 'DB Goblet Squat',
    implement: 'dumbbell-pair',
    kind: 'compound',
    days: ['Lower'],
    kneeLoaded: true,
    aliases: ['Goblet Squat'],
    note: 'Both dumbbells stacked at the chest. The default squat — no rack needed.',
  },
  {
    name: 'EZ Bar Front Squat',
    implement: 'bar',
    kind: 'compound',
    days: ['Lower'],
    kneeLoaded: true,
    aliases: ['Front Squat'],
    note: 'Available on request; the goblet squat is the default given no rack.',
  },
  {
    name: 'Leg Extension',
    implement: 'plates',
    kind: 'accessory',
    days: ['Lower'],
    kneeLoaded: true,
  },
  { name: 'Leg Curl', implement: 'plates', kind: 'accessory', days: ['Lower'], kneeLoaded: true },
  {
    name: 'Standing Calf Raise',
    implement: 'bar',
    kind: 'accessory',
    days: ['Lower'],
    note: 'Ankle-dominant and low risk. The DB standing version is fine when the shoulder-bar setup is a hassle — the log shows both.',
  },

  // ── Complexes ──
  {
    name: 'EZ Bar Front Squat-to-Press',
    implement: 'bar',
    kind: 'compound',
    days: ['Lower'],
    kneeLoaded: true,
    complex: true,
    aliases: ['Thruster'],
    note: 'Cap the load at what the press can take, not the squat.',
  },
  {
    name: 'EZ Bar RDL-to-Bent-Over-Row',
    implement: 'bar',
    kind: 'compound',
    days: ['Lower'],
    complex: true,
  },
];

export const DEFAULT_SETTINGS: TrainerSettings = {
  inventory: SEED_INVENTORY,
  catalogue: SEED_CATALOGUE,
  policy: '',
};

export function readSettings(): TrainerSettings {
  const stored = readJson<Partial<TrainerSettings>>(FILE);
  if (!stored) return DEFAULT_SETTINGS;

  return {
    inventory: stored.inventory ?? DEFAULT_SETTINGS.inventory,
    catalogue:
      Array.isArray(stored.catalogue) && stored.catalogue.length > 0
        ? stored.catalogue
        : DEFAULT_SETTINGS.catalogue,
    policy: typeof stored.policy === 'string' ? stored.policy : '',
  };
}

export function writeSettings(settings: TrainerSettings): void {
  writeJson(FILE, settings);
}
