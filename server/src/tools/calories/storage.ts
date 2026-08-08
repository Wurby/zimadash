import crypto from 'node:crypto';
import { listDataFiles, readJson, writeJson } from '../../paths.js';
import type { Entry } from '../../shared/calories.js';

/**
 * Entries on disk: one JSON file per month under `calories/` in DATA_DIR.
 *
 * Roughly 2,000 entries a year at a couple of hundred bytes each — a database
 * would be machinery for nothing. A month per file keeps any single write small
 * and means a date range touches two or three files rather than loading years.
 *
 * Every file carries a `version` and is migrated on read, so a schema change
 * later is a function here rather than a rescue operation.
 */

const DIR = 'calories';
const VERSION = 1;

/**
 * A day ends at 4am, not midnight. A 1am snack belongs to the night you were
 * still awake for, not to the morning that hasn't started — logging it against
 * a fresh day wrecks the day that hasn't begun and flatters the one you
 * actually overate on.
 */
const ROLLOVER_HOUR = 4;

interface MonthFile {
  version: number;
  entries: Entry[];
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** The YYYY-MM-DD a timestamp belongs to, once the 4am rollover is applied. */
export function dayKeyFor(at: number): string {
  const d = new Date(at);
  if (d.getHours() < ROLLOVER_HOUR) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Walk back n days from a day key, staying on the rollover grid. */
export function shiftDayKey(dayKey: string, days: number): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  // Noon avoids any daylight-saving edge landing on the wrong date.
  const date = new Date(y, m - 1, d, 12);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const monthOf = (dayKey: string): string => dayKey.slice(0, 7);
const fileFor = (month: string): string => `${DIR}/${month}.json`;

/**
 * Ids carry the day they belong to, so patching or deleting an entry knows
 * which file to open without scanning every month on disk.
 */
function makeId(dayKey: string): string {
  return `${dayKey}:${crypto.randomBytes(6).toString('hex')}`;
}

const monthOfId = (id: string): string => id.slice(0, 7);

function migrate(raw: unknown): MonthFile {
  const file = raw as Partial<MonthFile> | null;
  if (!file || !Array.isArray(file.entries)) return { version: VERSION, entries: [] };

  // Only one version so far. Future migrations chain from here, each stepping
  // the file forward one version, so an old file is never read as a new one.
  return { version: VERSION, entries: file.entries };
}

function readMonth(month: string): MonthFile {
  return migrate(readJson<MonthFile>(fileFor(month)));
}

function writeMonth(month: string, file: MonthFile): void {
  writeJson(fileFor(month), { ...file, version: VERSION });
}

export function addEntry(input: Omit<Entry, 'id'>): Entry {
  const dayKey = dayKeyFor(input.at);
  const entry: Entry = { ...input, id: makeId(dayKey) };

  const month = monthOf(dayKey);
  const file = readMonth(month);
  file.entries.push(entry);
  writeMonth(month, file);

  return entry;
}

export function findEntry(id: string): Entry | null {
  return readMonth(monthOfId(id)).entries.find((entry) => entry.id === id) ?? null;
}

export function patchEntry(id: string, values: Record<string, number>): Entry | null {
  const month = monthOfId(id);
  const file = readMonth(month);
  const entry = file.entries.find((candidate) => candidate.id === id);
  if (!entry) return null;

  entry.values = values;
  entry.edited = true;
  writeMonth(month, file);
  return entry;
}

export function deleteEntry(id: string): boolean {
  const month = monthOfId(id);
  const file = readMonth(month);
  const before = file.entries.length;
  file.entries = file.entries.filter((entry) => entry.id !== id);
  if (file.entries.length === before) return false;

  writeMonth(month, file);
  return true;
}

/** Every entry between two day keys, inclusive, oldest first. */
export function entriesInRange(fromDay: string, toDay: string): Entry[] {
  const months = new Set<string>();
  for (let day = fromDay; day <= toDay; day = shiftDayKey(day, 1)) {
    months.add(monthOf(day));
  }

  return [...months]
    .sort()
    .flatMap((month) => readMonth(month).entries)
    .filter((entry) => {
      const day = dayKeyFor(entry.at);
      return day >= fromDay && day <= toDay;
    })
    .sort((a, b) => a.at - b.at);
}

export function entriesForDay(dayKey: string): Entry[] {
  return entriesInRange(dayKey, dayKey);
}

/** Newest first, across however many months it takes to find `limit`. */
export function recentEntries(limit: number): Entry[] {
  const months = listDataFiles(DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.replace(/\.json$/, ''))
    .sort()
    .reverse();

  const found: Entry[] = [];
  for (const month of months) {
    found.push(...readMonth(month).entries);
    if (found.length >= limit) break;
  }

  return found.sort((a, b) => b.at - a.at).slice(0, limit);
}
