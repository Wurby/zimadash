import crypto from 'node:crypto';
import { listDataFiles, readJson, writeJson } from '../../paths.js';
import type { Entry } from '../../shared/calories.js';
import { dayKeyFromMs, monthKey, shiftDayKey } from '../../shared/calories.js';

export { dayKeyFromMs as dayKeyFor, shiftDayKey };

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

interface MonthFile {
  version: number;
  entries: Entry[];
}

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
  const dayKey = dayKeyFromMs(input.at);
  const entry: Entry = { ...input, id: makeId(dayKey) };

  const month = monthKey(dayKey);
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
    months.add(monthKey(day));
  }

  return [...months]
    .sort()
    .flatMap((month) => readMonth(month).entries)
    .filter((entry) => {
      const day = dayKeyFromMs(entry.at);
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

/** Every named entry on disk, oldest first. Used by search and clustering. */
export function allEntries(): Entry[] {
  const months = listDataFiles(DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.replace(/\.json$/, ''))
    .sort();

  return months.flatMap((month) => readMonth(month).entries).sort((a, b) => a.at - b.at);
}

export function searchEntries(query: string, limit = 50): Entry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const hits: Entry[] = [];
  const months = listDataFiles(DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.replace(/\.json$/, ''))
    .sort()
    .reverse();

  for (const month of months) {
    const batch = readMonth(month)
      .entries.filter((entry) => {
        if (entry.description.toLowerCase().includes(needle)) return true;
        return (entry.assumptions ?? '').toLowerCase().includes(needle);
      })
      .sort((a, b) => b.at - a.at);
    hits.push(...batch);
    if (hits.length >= limit) break;
  }

  return hits.slice(0, limit);
}
