import { readJson, writeJson } from '../../paths.js';
import type { WeightReading } from '../../shared/calories.js';

/**
 * Weigh-ins, in their own versioned file.
 *
 * One reading per day: you step on the scale once, and if you log twice the
 * later one replaces the earlier rather than both counting. A year of this is a
 * few hundred tiny records, so it lives in one file — a date range for the
 * trend wants the whole run anyway, not a month of it.
 */

const FILE = 'calories/weight.json';
const VERSION = 1;

interface WeightFile {
  version: number;
  readings: WeightReading[];
}

function migrate(raw: unknown): WeightFile {
  const file = raw as Partial<WeightFile> | null;
  if (!file || !Array.isArray(file.readings)) return { version: VERSION, readings: [] };
  return { version: VERSION, readings: file.readings };
}

function read(): WeightFile {
  return migrate(readJson<WeightFile>(FILE));
}

export function allReadings(): WeightReading[] {
  return read().readings.sort((a, b) => a.date.localeCompare(b.date));
}

/** Record a weigh-in, replacing that day's if there is one. */
export function putReading(date: string, lb: number): WeightReading[] {
  const file = read();
  file.readings = [...file.readings.filter((r) => r.date !== date), { date, lb }].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  writeJson(FILE, file);
  return file.readings;
}

export function deleteReading(date: string): WeightReading[] {
  const file = read();
  file.readings = file.readings.filter((reading) => reading.date !== date);
  writeJson(FILE, file);
  return file.readings;
}
