import { randomUUID } from 'node:crypto';
import {
  findExercise,
  loadLadder,
  ratingFromCanonical,
  type ExerciseDef,
  type Inventory,
  type Session,
  type SessionExercise,
  type SessionType,
} from '../../shared/trainer.js';

/**
 * Read the vault's `workout-log.md` into real sessions.
 *
 * **Tolerant on purpose, and lossy nowhere.** The log is prose written by hand
 * over months — weights read "Bodyweight + 15 lb DB", rep schemes read
 * "3x~20 (to failure)", difficulties read "6-7 (incomplete — the bench frame
 * blocked it)". Anything that can be parsed is; anything that can't is kept
 * verbatim in the session's `importNotes` rather than dropped, because this is
 * the only copy of that history.
 *
 * Import is one-way. Nothing is ever written back to the vault — two-way sync
 * between a markdown table and a store is a corruption source, and an export
 * covers the escape hatch instead.
 */

const HEADING = /^###\s+(\d{4}-\d{2}-\d{2})\s*[—–-]\s*(.+?)\s*$/;
const SEPARATOR = /^\|[\s|:-]+\|$/;

export interface ImportResult {
  sessions: Session[];
  /** Everything the parser wanted a human to know, across the whole file. */
  notes: string[];
}

/** "Lower Body" / "Upper Body (B)" → the rotation's own names. */
function normaliseType(raw: string): SessionType | null {
  const text = raw.toLowerCase();
  if (text.includes('lower')) return 'Lower';
  if (text.includes('upper')) {
    if (/\bb\b|\(b\)/.test(text)) return 'Upper B';
    return 'Upper A';
  }
  return null;
}

/** Everything before the first parenthesis — the commentary is context, not
 *  part of the name. */
function cleanName(raw: string): string {
  const open = raw.indexOf('(');
  return (open === -1 ? raw : raw.slice(0, open)).trim();
}

/**
 * The first number in the cell.
 *
 * That happens to be right for every shape in the log: "65 lb" is 65,
 * "30 lb (2x15 lb DB)" is the 30 that was lifted, and "Bodyweight + 15 lb DB"
 * is the 15 that was added on top.
 */
function parseWeight(raw: string): number | null {
  const match = raw.match(/(\d+(?:\.\d+)?)/);
  if (match) return Number(match[1]);
  if (/bodyweight/i.test(raw)) return 0;
  return null;
}

interface Scheme {
  sets: number;
  reps: number;
  format: 'straight' | 'density';
  note?: string;
}

function parseScheme(raw: string): Scheme | null {
  const density = /@\s*\d+\s*s/i.test(raw);
  const pair = raw.match(/(\d+)\s*[x×]\s*~?\s*(\d+)/);

  if (pair) {
    const sets = Number(pair[1]);
    const reps = Number(pair[2]);
    const ranged = /\d+\s*[x×]\s*~?\s*\d+\s*[-–]\s*\d+/.test(raw);
    return {
      sets,
      reps,
      format: density ? 'density' : 'straight',
      note: ranged ? `rep range "${raw.trim()}" recorded at its lower end` : undefined,
    };
  }

  // A bare number is reps — the log does this when the set count wasn't noted.
  const single = raw.match(/(\d+)/);
  if (single) {
    return {
      sets: 1,
      reps: Number(single[1]),
      format: 'straight',
      note: `"${raw.trim()}" had no set count; recorded as 1 set`,
    };
  }

  return null;
}

/** "5-6" → 5.5. Trailing commentary is ignored; a cell with no leading number
 *  has no rating at all. */
function parseDifficulty(raw: string): number | null {
  const match = raw.match(/^\s*(\d+(?:\.\d+)?)\s*(?:[-–]\s*(\d+(?:\.\d+)?))?/);
  if (!match) return null;
  const low = Number(match[1]);
  const high = match[2] === undefined ? low : Number(match[2]);
  return (low + high) / 2;
}

function splitRow(line: string): string[] {
  return line
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

export function parseVaultLog(
  markdown: string,
  catalogue: ExerciseDef[],
  inventory: Inventory,
): ImportResult {
  const sessions: Session[] = [];
  const notes: string[] = [];

  let current: Session | null = null;

  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(HEADING);

    if (heading) {
      const [, date, rawType] = heading as unknown as [string, string, string];
      const type = normaliseType(rawType);

      if (!type) {
        notes.push(`${date}: could not tell which session type "${rawType}" is — skipped`);
        current = null;
        continue;
      }

      current = {
        id: randomUUID(),
        date,
        type,
        status: 'done',
        cursor: 0,
        exercises: [],
        plannedBy: 'import',
        importNotes: [],
      };
      sessions.push(current);
      continue;
    }

    if (!current || !line.trim().startsWith('|') || SEPARATOR.test(line.trim())) continue;

    const cells = splitRow(line);
    if (cells.length < 4) continue;

    const [rawName = '', rawWeight = '', rawScheme = '', rawDifficulty = ''] = cells;
    // The table's own header row.
    if (/^exercise$/i.test(rawName)) continue;

    const name = cleanName(rawName);
    if (!name) continue;

    const known = findExercise(catalogue, name);
    const implement = known?.implement ?? 'bar';

    if (!known) {
      current.importNotes!.push(
        `"${name}" isn't in the catalogue — kept, and assumed to load like a bar lift`,
      );
    }

    const rawParenthetical = rawName.includes('(') ? rawName.slice(rawName.indexOf('(')) : '';
    if (rawParenthetical) {
      current.importNotes!.push(`${name}: ${rawParenthetical.replace(/^\(|\)$/g, '')}`);
    }

    const weight = parseWeight(rawWeight);
    const scheme = parseScheme(rawScheme);
    const difficulty = parseDifficulty(rawDifficulty);

    if (weight === null) {
      current.importNotes!.push(`${name}: no weight readable from "${rawWeight}" — recorded as 0`);
    }
    if (!scheme) {
      current.importNotes!.push(`${name}: no sets/reps readable from "${rawScheme}"`);
    }
    if (scheme?.note) current.importNotes!.push(`${name}: ${scheme.note}`);
    if (difficulty === null) {
      current.importNotes!.push(
        `${name}: no rating in "${rawDifficulty}" — recorded at the target`,
      );
    }

    // **The logged weight is kept exactly as written.** It is a record of what
    // was lifted, and an import that quietly moved it to the nearest rung would
    // be rewriting history to fit a model of the equipment — the wrong way
    // round. Off-ladder figures are flagged instead, usually because a movement
    // was done on a different implement that day than the catalogue assumes.
    // Snapping still happens where it belongs: on the next prescription.
    const ladder = loadLadder(inventory, implement);
    const lifted = weight ?? 0;
    if (lifted > 0 && !ladder.includes(lifted)) {
      current.importNotes!.push(
        `${name}: ${lifted}lb isn't a load the ${implement} ladder builds — kept as logged, ` +
          `so it was probably done on something else that day`,
      );
    }

    const exercise: SessionExercise = {
      name: known?.name ?? name,
      implement,
      kneeLoaded: known?.kneeLoaded,
      format: scheme?.format === 'density' ? 'density' : known?.complex ? 'complex' : 'straight',
      prescribed: { weightLb: lifted, sets: scheme?.sets ?? 1, reps: scheme?.reps ?? 0 },
      result: {
        weightLb: lifted,
        sets: scheme?.sets ?? 1,
        reps: scheme?.reps ?? 0,
        // No rating in the cell means it was commentary, not a score. Recording
        // it at the target keeps it from dragging a future suggestion around.
        rating: ratingFromCanonical(difficulty ?? 6.5),
      },
    };

    current.exercises.push(exercise);
  }

  const empty = sessions.filter((session) => session.exercises.length === 0);
  for (const session of empty) {
    notes.push(`${session.date}: heading found but no readable rows`);
  }

  return { sessions: sessions.filter((session) => session.exercises.length > 0), notes };
}
