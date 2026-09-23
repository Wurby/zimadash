import crypto from 'node:crypto';
import { listDataFiles, personal, readJson, writeJson } from '../../paths.js';
import type { DigestionEntry, Severity } from '../../shared/calories.js';
import { dayKeyFromMs, monthKey, shiftDayKey } from '../../shared/calories.js';

export { dayKeyFromMs as dayKeyFor, shiftDayKey };

/**
 * Digestive episodes: same one-file-per-month layout as meal entries, in a
 * sibling directory so the two never collide. See storage.ts for the reasoning
 * — this mirrors it deliberately rather than sharing code, since the two
 * records don't share a shape.
 */

function dir(): string {
  return personal('calories/digestion');
}
const VERSION = 1;

interface MonthFile {
  version: number;
  entries: DigestionEntry[];
}

const fileFor = (month: string): string => `${dir()}/${month}.json`;
const monthOfId = (id: string): string => id.slice(0, 7);

function makeId(dayKey: string): string {
  return `${dayKey}:${crypto.randomBytes(6).toString('hex')}`;
}

function migrate(raw: unknown): MonthFile {
  const file = raw as Partial<MonthFile> | null;
  if (!file || !Array.isArray(file.entries)) return { version: VERSION, entries: [] };
  return { version: VERSION, entries: file.entries };
}

function readMonth(month: string): MonthFile {
  return migrate(readJson<MonthFile>(fileFor(month)));
}

function writeMonth(month: string, file: MonthFile): void {
  writeJson(fileFor(month), { ...file, version: VERSION });
}

export function addEpisode(severity: Severity, at: number = Date.now()): DigestionEntry {
  const dayKey = dayKeyFromMs(at);
  const entry: DigestionEntry = { id: makeId(dayKey), at, severity };

  const month = monthKey(dayKey);
  const file = readMonth(month);
  file.entries.push(entry);
  writeMonth(month, file);

  return entry;
}

/** Same re-keying rule as storage.ts's updateEntry: moving `at` across a day
 *  boundary invalidates the id's day prefix, so the entry gets a fresh one. */
export function updateEpisode(
  id: string,
  patch: { severity?: Severity; at?: number },
): DigestionEntry | null {
  const month = monthOfId(id);
  const file = readMonth(month);
  const idx = file.entries.findIndex((candidate) => candidate.id === id);
  if (idx === -1) return null;
  const entry: DigestionEntry = { ...file.entries[idx] };

  if (patch.severity !== undefined) entry.severity = patch.severity;
  if (patch.at !== undefined) entry.at = patch.at;

  const oldDayKey = dayKeyFromMs(file.entries[idx].at);
  const newDayKey = dayKeyFromMs(entry.at);
  if (newDayKey === oldDayKey) {
    file.entries[idx] = entry;
    writeMonth(month, file);
    return entry;
  }

  file.entries.splice(idx, 1);
  writeMonth(month, file);

  const moved: DigestionEntry = { ...entry, id: makeId(newDayKey) };
  const newMonth = monthKey(newDayKey);
  const targetFile = readMonth(newMonth);
  targetFile.entries.push(moved);
  writeMonth(newMonth, targetFile);
  return moved;
}

export function deleteEpisode(id: string): boolean {
  const month = monthOfId(id);
  const file = readMonth(month);
  const before = file.entries.length;
  file.entries = file.entries.filter((entry) => entry.id !== id);
  if (file.entries.length === before) return false;

  writeMonth(month, file);
  return true;
}

function months(): string[] {
  return listDataFiles(dir())
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.replace(/\.json$/, ''))
    .sort();
}

/** Every episode on disk, oldest first. Used by the suspects analysis and the
 *  weekday/daypart patterns, both of which want the whole history. */
export function allEpisodes(): DigestionEntry[] {
  return months()
    .flatMap((month) => readMonth(month).entries)
    .sort((a, b) => a.at - b.at);
}

export function episodesInRange(fromDay: string, toDay: string): DigestionEntry[] {
  const wanted = new Set<string>();
  for (let day = fromDay; day <= toDay; day = shiftDayKey(day, 1)) wanted.add(monthKey(day));

  return [...wanted]
    .sort()
    .flatMap((month) => readMonth(month).entries)
    .filter((entry) => {
      const day = dayKeyFromMs(entry.at);
      return day >= fromDay && day <= toDay;
    })
    .sort((a, b) => a.at - b.at);
}

/** Newest first — the flat recent-episodes list on the Digestion tab. */
export function recentEpisodes(limit: number): DigestionEntry[] {
  const reversed = [...months()].reverse();
  const found: DigestionEntry[] = [];
  for (const month of reversed) {
    found.push(...readMonth(month).entries);
    if (found.length >= limit) break;
  }
  return found.sort((a, b) => b.at - a.at).slice(0, limit);
}
