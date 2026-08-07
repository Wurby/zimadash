import { Router } from 'express';
import type { ServerTool } from '../registry.js';
import type { DaySummary, Entry, Settings } from '../../shared/calories.js';
import { RANGE_DAYS, type RangeKey } from '../../shared/calories.js';
import { readSettings, writeSettings, trackedFields } from './settings.js';
import { refineEstimate, startEstimate, takeThread } from './brain.js';
import {
  addEntry,
  dayKeyFor,
  deleteEntry,
  entriesForDay,
  entriesInRange,
  patchEntry,
  recentEntries,
  shiftDayKey,
} from './storage.js';

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
  res.json({ date, totals: totalsFor(entries), entries } satisfies DaySummary);
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

/** The log tab: about two weeks of entries, newest first. */
router.get('/log', (_req, res) => {
  const today = dayKeyFor(Date.now());
  const entries = entriesInRange(shiftDayKey(today, -13), today);
  res.json({ entries: entries.reverse() });
});

/** Distinct recent meals, for one-tap re-logging without touching the brain. */
router.get('/recent', (_req, res) => {
  const seen = new Set<string>();
  const meals = recentEntries(60)
    .filter((entry) => entry.description.trim() && Object.keys(entry.values).length > 0)
    .filter((entry) => {
      const key = entry.description.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8)
    .map(({ description, values }) => ({ description, values }));

  res.json({ meals });
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

const tool: ServerTool = { slug: 'calories', router };
export default tool;
