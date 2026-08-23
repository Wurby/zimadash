import { Router } from 'express';
import type { ServerTool } from '../registry.js';
import type { DaySummary, Entry, LogGrain, LogSummary, Settings } from '../../shared/calories.js';
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
  reestimateEntry,
  refineEstimate,
  startEstimate,
  startImageEstimate,
  takeThread,
} from './brain.js';
import {
  addEntry,
  dayKeyFor,
  deleteEntry,
  entriesForDay,
  entriesInRange,
  findEntry,
  patchEntry,
  recentEntries,
  searchEntries,
  shiftDayKey,
} from './storage.js';
import { cachedChips, startClusterLoop } from './clusters.js';
import {
  adjustDay,
  approveDay,
  dropItem,
  fillItem,
  itemsForDay,
  loggingSuspended,
  pendingTotalsFor,
  queueDirect,
  queuePhoto,
  queueText,
  resumeWorking,
  reviewDay,
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
  const oldest = reviewDay(date);
  res.json({
    date,
    totals: totalsFor(entries),
    pendingTotals: pendingTotalsFor(date),
    entries,
    unreviewedDay: oldest < date ? oldest : null,
  } satisfies DaySummary);
});

router.get('/review', (_req, res) => {
  const today = dayKeyFor(Date.now());
  const day = reviewDay(today);
  const entries = entriesForDay(day);
  const items = itemsForDay(day);
  res.json({
    today,
    day,
    suspended: loggingSuspended(today),
    items,
    entries,
    totals: totalsFor(entries),
    pendingTotals: pendingTotalsFor(day),
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
  if (loggingSuspended(dayKeyFor(Date.now()))) {
    res.status(409).json({ error: 'review the previous day before logging' });
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
  if (loggingSuspended(dayKeyFor(Date.now()))) {
    res.status(409).json({ error: 'review the previous day before logging' });
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
  if (loggingSuspended(dayKeyFor(Date.now()))) {
    res.status(409).json({ error: 'review the previous day before logging' });
    return;
  }
  res.status(202).json(queueDirect(description, clean));
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

router.post('/queue/adjust', async (req, res) => {
  const feedback = typeof req.body?.feedback === 'string' ? req.body.feedback.trim() : '';
  if (!feedback) {
    res.status(400).json({ error: 'say what to change' });
    return;
  }
  const today = dayKeyFor(Date.now());
  const day = typeof req.body?.day === 'string' ? req.body.day : reviewDay(today);
  const result = await adjustDay(day, feedback);
  if (result.error) {
    res.status(503).json({ error: result.error });
    return;
  }
  res.json({ ok: true, items: itemsForDay(day) });
});

router.post('/queue/approve', (req, res) => {
  const today = dayKeyFor(Date.now());
  const day = typeof req.body?.day === 'string' ? req.body.day : reviewDay(today);
  const result = approveDay(day);
  if ('error' in result) {
    res.status(409).json({ error: result.error });
    return;
  }
  res.json({ ok: true });
});

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
  const entries = entriesInRange(from, today);

  const byDay = new Map<string, Entry[]>();
  for (const entry of entries) {
    const day = dayKeyFor(entry.at);
    byDay.set(day, [...(byDay.get(day) ?? []), entry]);
  }

  res.json({
    from,
    to: today,
    days: [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, dayEntries]) => ({ date, totals: totalsFor(dayEntries) })),
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

/** Distinct meals for one-tap re-logging. Clustered when the weekly pass has run. */
router.get('/recent', (_req, res) => {
  const clustered = cachedChips();
  if (clustered) {
    res.json({ meals: clustered });
    return;
  }

  const seen = new Set<string>();
  const meals = recentEntries(60)
    .filter((entry) => entry.description.trim() && Object.keys(entry.values).length > 0)
    .filter((entry) => {
      const key = entry.description.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 12)
    .map(({ description, values }) => ({ description, values }));

  res.json({ meals });
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

// ─── Estimating ──────────────────────────────────────────────────────────────

router.post('/estimate', async (req, res) => {
  const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
  if (!description) {
    res.status(400).json({ error: 'describe what you ate' });
    return;
  }

  try {
    res.json(await startEstimate(description));
  } catch (err) {
    res.status(503).json({ error: err instanceof Error ? err.message : 'estimate failed' });
  }
});

/**
 * Estimate from a photograph. The body is base64 rather than multipart so this
 * needs no upload dependency; the client downscales first, so a few hundred KB
 * arrives rather than a phone's full 5MB.
 */
router.post('/estimate/image', async (req, res) => {
  const raw = typeof req.body?.image === 'string' ? req.body.image : '';
  // Accept a bare base64 string or a whole data: URL.
  const base64 = raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw;

  if (!base64) {
    res.status(400).json({ error: 'no photo received' });
    return;
  }
  if (base64.length > 12_000_000) {
    res.status(413).json({ error: 'that photo is too large' });
    return;
  }

  try {
    res.json(await startImageEstimate(base64));
  } catch (err) {
    res.status(503).json({ error: err instanceof Error ? err.message : 'estimate failed' });
  }
});

router.post('/estimate/:id/refine', async (req, res) => {
  const feedback = typeof req.body?.feedback === 'string' ? req.body.feedback.trim() : '';
  if (!feedback) {
    res.status(400).json({ error: 'say what to change' });
    return;
  }

  try {
    const pending = await refineEstimate(req.params.id, feedback);
    if (!pending) {
      res.status(410).json({ error: 'that estimate has expired — start again' });
      return;
    }
    res.json(pending);
  } catch (err) {
    res.status(503).json({ error: err instanceof Error ? err.message : 'estimate failed' });
  }
});

// ─── Writing ─────────────────────────────────────────────────────────────────

router.post('/entries', (req, res) => {
  const body = req.body as {
    pendingId?: string;
    description?: string;
    values?: Record<string, number>;
  };

  // Committing an estimate: take the thread so a double-tap can't log twice.
  if (body?.pendingId) {
    const pending = takeThread(body.pendingId);
    if (!pending) {
      res.status(410).json({ error: 'that estimate has expired — start again' });
      return;
    }
    res.json(
      addEntry({
        at: Date.now(),
        description: pending.description,
        values: body.values ?? pending.values,
        assumptions: pending.assumptions,
      }),
    );
    return;
  }

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
 * Correct a logged meal by describing what was wrong. Returns a pending estimate
 * that refines through the ordinary route; approving it PATCHes this entry.
 */
router.post('/entries/:id/reestimate', async (req, res) => {
  const feedback = typeof req.body?.feedback === 'string' ? req.body.feedback.trim() : '';
  if (!feedback) {
    res.status(400).json({ error: 'say what was wrong with it' });
    return;
  }

  const entry = findEntry(req.params.id);
  if (!entry) {
    res.status(404).json({ error: 'no such entry' });
    return;
  }

  try {
    res.json(await reestimateEntry(entry.description, entry.values, feedback));
  } catch (err) {
    res.status(503).json({ error: err instanceof Error ? err.message : 'estimate failed' });
  }
});

router.patch('/entries/:id', (req, res) => {
  const values = req.body?.values as Record<string, number> | undefined;
  if (!values || typeof values !== 'object') {
    res.status(400).json({ error: 'values are required' });
    return;
  }

  const clean: Record<string, number> = {};
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'number' && Number.isFinite(value)) clean[key] = value;
  }

  const entry = patchEntry(req.params.id, clean);
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

resumeWorking();
startClusterLoop();

const tool: ServerTool = { slug: 'calories', router };
export default tool;
