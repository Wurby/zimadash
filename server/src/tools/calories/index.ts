import { Router } from 'express';
import type { ServerTool } from '../registry.js';
import { listUsers } from '../../auth.js';
import { runAs } from '../../context.js';
import type {
  DaySummary,
  Entry,
  LogGrain,
  LogSummary,
  Severity,
  Settings,
} from '../../shared/calories.js';
import {
  RANGE_DAYS,
  endOfMonth,
  endOfWeek,
  endOfYear,
  monthKey,
  startOfMonth,
  startOfWeek,
  startOfYear,
  type RangeKey,
} from '../../shared/calories.js';
import { readSettings, writeSettings, trackedFields } from './settings.js';
import { allReadings, deleteReading, putReading } from './weight.js';
import { computeExpenditure, trendSeries } from './expenditure.js';
import {
  addEntry,
  dayKeyFor,
  deleteEntry,
  entriesForDay,
  entriesInRange,
  searchEntries,
  shiftDayKey,
  updateEntry,
  allEntries,
} from './storage.js';
import {
  addEpisode,
  allEpisodes,
  deleteEpisode,
  episodesInRange,
  recentEpisodes,
  updateEpisode,
} from './digestion.js';
import { computePatterns, computeSuspects, digestionDays } from './digestionAnalysis.js';
import { cachedChips, fallbackChips, startClusterLoop } from './clusters.js';
import {
  adjustError,
  clearReestimate,
  dropItem,
  fillItem,
  isAdjusting,
  itemsForDay,
  queueAdjust,
  queueDirect,
  queuePhoto,
  queueReestimate,
  queueText,
  reestimateStatus,
  resumeWorking,
} from './queue.js';

/**
 * Everything under /api/tools/calories. Owns its own files in DATA_DIR and
 * reaches into nothing else, so lifting it into its own repo stays a matter of
 * deleting a folder and a line in the registry.
 */

const router = Router();

function totalsFor(entries: Entry[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const entry of entries) {
    for (const [field, value] of Object.entries(entry.values)) {
      totals[field] = Math.round(((totals[field] ?? 0) + value) * 10) / 10;
    }
  }
  return totals;
}

function summarise(entries: Entry[]): LogSummary {
  const days = new Set(entries.map((entry) => dayKeyFor(entry.at)));
  const calories = entries.reduce((sum, entry) => sum + (entry.values.calories ?? 0), 0);
  const daysLogged = days.size;
  return {
    meals: entries.length,
    daysLogged,
    averageDailyCalories: daysLogged === 0 ? 0 : Math.round((calories / daysLogged) * 10) / 10,
  };
}

function windowFor(grain: LogGrain, date: string): { from: string; to: string } {
  if (grain === 'day') return { from: date, to: date };
  if (grain === 'week') return { from: startOfWeek(date), to: endOfWeek(date) };
  if (grain === 'month') return { from: startOfMonth(date), to: endOfMonth(date) };
  return { from: startOfYear(date), to: endOfYear(date) };
}

function latestPills(entries: Entry[]): { description: string; values: Record<string, number> }[] {
  const newest = [...entries].sort((a, b) => b.at - a.at);
  const seen = new Set<string>();
  const pills: { description: string; values: Record<string, number> }[] = [];
  for (const entry of newest) {
    const key = entry.description.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    pills.push({ description: entry.description, values: entry.values });
  }
  return pills;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const GRAINS = new Set<LogGrain>(['day', 'week', 'month', 'year']);

// ─── Settings ────────────────────────────────────────────────────────────────

router.get('/settings', (_req, res) => {
  res.json(readSettings());
});

router.put('/settings', (req, res) => {
  const body = req.body as Partial<Settings>;
  if (!Array.isArray(body?.fields)) {
    res.status(400).json({ error: 'fields must be an array' });
    return;
  }
  res.json(writeSettings(body as Settings));
});

// ─── Reading ─────────────────────────────────────────────────────────────────

router.get('/day', (_req, res) => {
  const date = dayKeyFor(Date.now());
  const entries = entriesForDay(date);
  res.json({
    date,
    totals: totalsFor(entries),
    entries,
  } satisfies DaySummary);
});

router.get('/review', (_req, res) => {
  const today = dayKeyFor(Date.now());
  const entries = entriesForDay(today);
  res.json({
    today,
    day: today,
    items: itemsForDay(today),
    entries,
    totals: totalsFor(entries),
    adjusting: isAdjusting(),
    adjustError: adjustError(),
  });
});

router.post('/queue/photo', (req, res) => {
  const raw = typeof req.body?.image === 'string' ? req.body.image : '';
  const base64 = raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw;
  if (!base64) {
    res.status(400).json({ error: 'no photo received' });
    return;
  }
  if (base64.length > 12_000_000) {
    res.status(413).json({ error: 'that photo is too large' });
    return;
  }
  res.status(202).json(queuePhoto(base64));
});

router.post('/queue/text', (req, res) => {
  const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
  if (!description) {
    res.status(400).json({ error: 'describe what you ate' });
    return;
  }
  res.status(202).json(queueText(description));
});

router.post('/queue/direct', (req, res) => {
  const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
  const values = req.body?.values as Record<string, number> | undefined;
  if (!values || typeof values !== 'object') {
    res.status(400).json({ error: 'values are required' });
    return;
  }
  const allowed = new Set(trackedFields().map((field) => field.id));
  const clean: Record<string, number> = {};
  for (const [key, value] of Object.entries(values)) {
    if (allowed.has(key) && typeof value === 'number' && Number.isFinite(value)) {
      clean[key] = value;
    }
  }
  if (Object.keys(clean).length === 0) {
    res.status(400).json({ error: 'nothing to log' });
    return;
  }
  res.json(queueDirect(description, clean));
});

router.delete('/queue/:id', (req, res) => {
  if (!dropItem(req.params.id)) {
    res.status(409).json({ error: 'cannot drop that item yet' });
    return;
  }
  res.json({ ok: true });
});

router.post('/queue/:id/fill', (req, res) => {
  const raw = typeof req.body?.image === 'string' ? req.body.image : '';
  const base64 = raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw;
  const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
  const item = fillItem(req.params.id, description || undefined, base64 || undefined);
  if (!item) {
    res.status(409).json({ error: 'cannot fill that item yet' });
    return;
  }
  res.status(202).json(item);
});

router.post('/queue/adjust', (req, res) => {
  const feedback = typeof req.body?.feedback === 'string' ? req.body.feedback.trim() : '';
  if (!feedback) {
    res.status(400).json({ error: 'say what to change' });
    return;
  }
  const today = dayKeyFor(Date.now());
  const day = typeof req.body?.day === 'string' ? req.body.day : today;
  const result = queueAdjust(day, feedback);
  if (result.error) {
    res.status(409).json({ error: result.error });
    return;
  }
  res.status(202).json({ ok: true });
});

function rangeWindow(
  from: string,
  to: string,
): {
  from: string;
  to: string;
  days: { date: string; totals: Record<string, number> }[];
} {
  const entries = entriesInRange(from, to);
  const byDay = new Map<string, Entry[]>();
  for (const entry of entries) {
    const day = dayKeyFor(entry.at);
    byDay.set(day, [...(byDay.get(day) ?? []), entry]);
  }
  return {
    from,
    to,
    days: [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, dayEntries]) => ({ date, totals: totalsFor(dayEntries) })),
  };
}

/** Daily totals across a range, for the graphs. Days with no entries are absent. */
router.get('/range/:range', (req, res) => {
  const range = req.params.range as RangeKey;
  const days = RANGE_DAYS[range];
  if (!days) {
    res.status(400).json({ error: `unknown range "${req.params.range}"` });
    return;
  }

  const today = dayKeyFor(Date.now());
  const from = shiftDayKey(today, -(days - 1));
  const prevTo = shiftDayKey(from, -1);
  const prevFrom = shiftDayKey(prevTo, -(days - 1));

  res.json({
    ...rangeWindow(from, today),
    previous: rangeWindow(prevFrom, prevTo),
  });
});

router.get('/log/search', (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  const hits = searchEntries(q).map((entry) => ({
    date: dayKeyFor(entry.at),
    entry,
  }));
  res.json({ hits });
});

/** The log tab: one grain (day/week/month/year) around a date. */
router.get('/log', (req, res) => {
  const today = dayKeyFor(Date.now());
  const grain = (typeof req.query.grain === 'string' ? req.query.grain : 'day') as LogGrain;
  if (!GRAINS.has(grain)) {
    res.status(400).json({ error: `unknown grain "${req.query.grain}"` });
    return;
  }

  const date =
    typeof req.query.date === 'string' && DATE_RE.test(req.query.date) ? req.query.date : today;
  const { from, to } = windowFor(grain, date);
  const entries = entriesInRange(from, to);
  const loggedDays = [...new Set(entries.map((entry) => dayKeyFor(entry.at)))].sort();

  res.json({
    grain,
    today,
    date,
    from,
    to,
    summary: summarise(entries),
    totals: totalsFor(entries),
    entries: grain === 'day' ? [...entries].reverse() : [],
    pills: grain === 'week' ? latestPills(entries) : [],
    loggedDays,
    loggedMonths: [...new Set(loggedDays.map((day) => monthKey(day)))],
  });
});

/** Distinct meals for one-tap re-logging. Clustered when the monthly pass has run. */
router.get('/recent', (_req, res) => {
  res.json({ meals: cachedChips() ?? fallbackChips() });
});

// ─── Weight ──────────────────────────────────────────────────────────────────

/** Readings, the smoothed trend, and what the tool has learned from them. */
router.get('/weight', (_req, res) => {
  const today = dayKeyFor(Date.now());
  const readings = allReadings();
  const settings = readSettings();

  // Intake per day across the whole span, so the expenditure maths can pair
  // each weigh-in with what was eaten that day.
  const intakeByDay = new Map<string, number>();
  if (readings.length > 0) {
    for (const entry of entriesInRange(readings[0].date, today)) {
      const day = dayKeyFor(entry.at);
      intakeByDay.set(day, (intakeByDay.get(day) ?? 0) + (entry.values.calories ?? 0));
    }
  }

  res.json({
    readings,
    trend: trendSeries(readings),
    expenditure: computeExpenditure(intakeByDay, readings, settings.weight, today),
  });
});

router.put('/weight/:date', (req, res) => {
  const lb = Number(req.body?.lb);
  if (!Number.isFinite(lb) || lb <= 0 || lb > 2000) {
    res.status(400).json({ error: 'that is not a weight' });
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.date)) {
    res.status(400).json({ error: 'bad date' });
    return;
  }
  res.json({ readings: putReading(req.params.date, Math.round(lb * 10) / 10) });
});

router.delete('/weight/:date', (req, res) => {
  res.json({ readings: deleteReading(req.params.date) });
});

/**
 * Draw a line under everything so far. Non-destructive on purpose: it records a
 * date the maths starts from, and deletes nothing.
 */
router.post('/weight/baseline', (_req, res) => {
  const settings = readSettings();
  res.json(
    writeSettings({
      ...settings,
      weight: { ...settings.weight, baselineDate: dayKeyFor(Date.now()) },
    }),
  );
});

// ─── Writing ─────────────────────────────────────────────────────────────────

router.post('/entries', (req, res) => {
  const body = req.body as {
    description?: string;
    values?: Record<string, number>;
  };

  // Hand-entered: a bare number, or a re-log of a recent meal.
  const values = body?.values;
  if (!values || typeof values !== 'object') {
    res.status(400).json({ error: 'values are required' });
    return;
  }

  const allowed = new Set(trackedFields().map((field) => field.id));
  const clean: Record<string, number> = {};
  for (const [key, value] of Object.entries(values)) {
    if (allowed.has(key) && typeof value === 'number' && Number.isFinite(value)) {
      clean[key] = value;
    }
  }

  if (Object.keys(clean).length === 0) {
    res.status(400).json({ error: 'nothing to log' });
    return;
  }

  res.json(
    addEntry({
      at: Date.now(),
      description: typeof body.description === 'string' ? body.description.trim() : '',
      values: clean,
    }),
  );
});

/**
 * Correct a logged meal by describing what was wrong. Fire-and-forget, like the
 * day-wide adjustment box — the brain call is never on the HTTP request, since
 * it shares one process with every other queued capture. The client polls the
 * status route below for the proposal, then PATCHes the entry itself.
 */
router.post('/entries/:id/reestimate', (req, res) => {
  const feedback = typeof req.body?.feedback === 'string' ? req.body.feedback.trim() : '';
  if (!feedback) {
    res.status(400).json({ error: 'say what was wrong with it' });
    return;
  }

  const result = queueReestimate(req.params.id, feedback);
  if (result.error) {
    res.status(409).json({ error: result.error });
    return;
  }
  res.status(202).json({ ok: true });
});

router.get('/entries/:id/reestimate', (req, res) => {
  res.json(reestimateStatus(req.params.id));
});

router.delete('/entries/:id/reestimate', (req, res) => {
  clearReestimate(req.params.id);
  res.json({ ok: true });
});

router.patch('/entries/:id', (req, res) => {
  const values = req.body?.values as Record<string, number> | undefined;
  const at = req.body?.at;

  const patch: { values?: Record<string, number>; at?: number } = {};
  if (values !== undefined) {
    if (typeof values !== 'object') {
      res.status(400).json({ error: 'values must be an object' });
      return;
    }
    const clean: Record<string, number> = {};
    for (const [key, value] of Object.entries(values)) {
      if (typeof value === 'number' && Number.isFinite(value)) clean[key] = value;
    }
    patch.values = clean;
  }
  if (at !== undefined) {
    if (typeof at !== 'number' || !Number.isFinite(at)) {
      res.status(400).json({ error: 'at must be a timestamp' });
      return;
    }
    patch.at = at;
  }
  if (patch.values === undefined && patch.at === undefined) {
    res.status(400).json({ error: 'nothing to update' });
    return;
  }

  const entry = updateEntry(req.params.id, patch);
  if (!entry) {
    res.status(404).json({ error: 'no such entry' });
    return;
  }
  res.json(entry);
});

router.delete('/entries/:id', (req, res) => {
  if (!deleteEntry(req.params.id)) {
    res.status(404).json({ error: 'no such entry' });
    return;
  }
  res.json({ ok: true });
});

// ─── Digestion ───────────────────────────────────────────────────────────────

function parseSeverity(value: unknown): Severity | null {
  return value === 1 || value === 2 || value === 3 ? value : null;
}

router.get('/digestion/recent', (_req, res) => {
  res.json({ episodes: recentEpisodes(200) });
});

router.post('/digestion', (req, res) => {
  const severity = parseSeverity(req.body?.severity);
  if (!severity) {
    res.status(400).json({ error: 'severity must be 1, 2, or 3' });
    return;
  }
  const at =
    typeof req.body?.at === 'number' && Number.isFinite(req.body.at) ? req.body.at : undefined;
  res.json(addEpisode(severity, at));
});

router.patch('/digestion/:id', (req, res) => {
  const patch: { severity?: Severity; at?: number } = {};

  if (req.body?.severity !== undefined) {
    const severity = parseSeverity(req.body.severity);
    if (!severity) {
      res.status(400).json({ error: 'severity must be 1, 2, or 3' });
      return;
    }
    patch.severity = severity;
  }
  if (req.body?.at !== undefined) {
    if (typeof req.body.at !== 'number' || !Number.isFinite(req.body.at)) {
      res.status(400).json({ error: 'at must be a timestamp' });
      return;
    }
    patch.at = req.body.at;
  }
  if (patch.severity === undefined && patch.at === undefined) {
    res.status(400).json({ error: 'nothing to update' });
    return;
  }

  const episode = updateEpisode(req.params.id, patch);
  if (!episode) {
    res.status(404).json({ error: 'no such episode' });
    return;
  }
  res.json(episode);
});

router.delete('/digestion/:id', (req, res) => {
  if (!deleteEpisode(req.params.id)) {
    res.status(404).json({ error: 'no such episode' });
    return;
  }
  res.json({ ok: true });
});

/** Ranked suspect foods, over the whole history — see digestionAnalysis.ts. */
router.get('/digestion/suspects', (_req, res) => {
  res.json(computeSuspects(allEntries(), allEpisodes()));
});

/** Raw weekday/daypart counts for the two relative-bar charts. */
router.get('/digestion/patterns', (_req, res) => {
  res.json(computePatterns(allEpisodes()));
});

/** Daily episode counts over a range, for the frequency chart. Same window
 *  shape as /range/:range. */
router.get('/digestion/range/:range', (req, res) => {
  const range = req.params.range as RangeKey;
  const days = RANGE_DAYS[range];
  if (!days) {
    res.status(400).json({ error: `unknown range "${req.params.range}"` });
    return;
  }

  const today = dayKeyFor(Date.now());
  const from = shiftDayKey(today, -(days - 1));
  const prevTo = shiftDayKey(from, -1);
  const prevFrom = shiftDayKey(prevTo, -(days - 1));

  res.json({
    from,
    to: today,
    days: digestionDays(episodesInRange(from, today)),
    previous: {
      from: prevFrom,
      to: prevTo,
      days: digestionDays(episodesInRange(prevFrom, prevTo)),
    },
  });
});

export function startCalories(): void {
  for (const user of listUsers()) {
    runAs(user, () => resumeWorking());
  }
  startClusterLoop();
}

const tool: ServerTool = { slug: 'calories', router };
export default tool;
