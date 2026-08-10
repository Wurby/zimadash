import { Router } from 'express';
import type { ServerTool } from '../registry.js';
import {
  IMPLEMENTS,
  currentStreak,
  dayKey,
  habitGrid,
  loadLadder,
  nextSessionType,
  personalRecords,
  volumeOf,
  weekKey,
  weeklySummaries,
  type Implement,
  type Session,
} from '../../shared/trainer.js';
import { readSettings, writeSettings, type TrainerSettings } from './settings.js';
import { allSessions, history, writeSessions } from './storage.js';
import { parseVaultLog } from './importVault.js';
import { planSession } from './planner.js';

/**
 * Personal trainer — everything under /api/tools/trainer.
 *
 * Phase one: the equipment model, the imported history, and everything derived
 * from it. Session running and the model layer come next; the rule-based
 * planner is already here because it is both the preview and the eventual
 * fallback.
 *
 * Owns its own files in DATA_DIR and reaches into nothing else.
 */

const router = Router();

/** Today, local to the server — the box and the phone share a timezone. */
function today(): string {
  return dayKey(new Date());
}

/** Every derived ladder, so the settings screen can show what the inventory
 *  actually buys you. */
function ladders(settings: TrainerSettings): Record<string, number[]> {
  const table: Record<string, number[]> = {};
  for (const implement of IMPLEMENTS) {
    table[implement] = loadLadder(settings.inventory, implement);
  }
  return table;
}

// ─── Overview ────────────────────────────────────────────────────────────────

router.get('/', (_req, res) => {
  const settings = readSettings();
  const done = history();
  const sessions = allSessions();
  const active = sessions.find((session) => session.status !== 'done') ?? null;

  const now = today();
  const weeks = weeklySummaries(done);
  const thisWeek = weeks.find((week) => week.week === weekKey(now));
  const last = done[done.length - 1] ?? null;

  res.json({
    next: nextSessionType(done),
    active,
    lastSession: last ? { date: last.date, type: last.type } : null,
    thisWeek: thisWeek?.count ?? 0,
    streak: currentStreak(done, now),
    sessionCount: done.length,
    hasSettings: settings.policy.length > 0,
  });
});

// ─── Settings ────────────────────────────────────────────────────────────────

router.get('/settings', (_req, res) => {
  const settings = readSettings();
  res.json({ ...settings, ladders: ladders(settings) });
});

router.put('/settings', (req, res) => {
  const current = readSettings();
  const next: TrainerSettings = { ...current };

  if (req.body?.inventory !== undefined) {
    const { barLb, plates, dumbbells } = req.body.inventory ?? {};
    if (typeof barLb !== 'number' || !Number.isFinite(barLb) || barLb < 0 || barLb > 200) {
      res.status(400).json({ error: 'barLb must be a weight between 0 and 200' });
      return;
    }
    if (!Array.isArray(plates) || !Array.isArray(dumbbells)) {
      res.status(400).json({ error: 'plates and dumbbells must be arrays' });
      return;
    }

    const clean = (list: unknown[]) =>
      list
        .map((entry) => entry as { lb?: unknown; pairs?: unknown })
        .filter(
          (entry) =>
            typeof entry.lb === 'number' &&
            Number.isFinite(entry.lb) &&
            entry.lb > 0 &&
            entry.lb <= 200 &&
            typeof entry.pairs === 'number' &&
            Number.isInteger(entry.pairs) &&
            entry.pairs > 0 &&
            entry.pairs <= 20,
        )
        .map((entry) => ({ lb: entry.lb as number, pairs: entry.pairs as number }));

    next.inventory = { barLb, plates: clean(plates), dumbbells: clean(dumbbells) };
  }

  if (req.body?.policy !== undefined) {
    if (typeof req.body.policy !== 'string' || req.body.policy.length > 40_000) {
      res.status(400).json({ error: 'policy must be text under 40,000 characters' });
      return;
    }
    next.policy = req.body.policy;
  }

  if (req.body?.catalogue !== undefined) {
    if (!Array.isArray(req.body.catalogue)) {
      res.status(400).json({ error: 'catalogue must be an array' });
      return;
    }
    const valid = req.body.catalogue.filter(
      (entry: { name?: unknown; implement?: unknown }) =>
        typeof entry?.name === 'string' &&
        entry.name.trim().length > 0 &&
        IMPLEMENTS.includes(entry.implement as Implement),
    );
    if (valid.length > 0) next.catalogue = valid;
  }

  writeSettings(next);
  res.json({ ...next, ladders: ladders(next) });
});

// ─── History ─────────────────────────────────────────────────────────────────

/**
 * A real date range from the start.
 *
 * The calorie tracker's Log tab shipped with a fixed fortnight window and that
 * is still an open loose end — no reason to repeat it here.
 */
router.get('/sessions', (req, res) => {
  const from = typeof req.query.from === 'string' ? req.query.from : '';
  const to = typeof req.query.to === 'string' ? req.query.to : '';

  const sessions = history().filter((session) => {
    if (from && session.date < from) return false;
    if (to && session.date > to) return false;
    return true;
  });

  res.json({ sessions: [...sessions].reverse() });
});

// ─── Progress ────────────────────────────────────────────────────────────────

router.get('/progress', (req, res) => {
  const done = history();
  const now = today();

  const from = typeof req.query.from === 'string' ? req.query.from : null;
  const start =
    from ??
    (() => {
      const date = new Date();
      date.setDate(date.getDate() - 364);
      return dayKey(date);
    })();

  const perSession = done.map((session) => ({
    date: session.date,
    type: session.type,
    volume: session.exercises
      .map((exercise) => exercise.result)
      .filter((result): result is NonNullable<typeof result> => !!result && !result.skipped)
      .reduce((sum, result) => sum + volumeOf(result), 0),
  }));

  res.json({
    grid: habitGrid(done, start, now),
    weeks: weeklySummaries(done),
    streak: currentStreak(done, now),
    records: personalRecords(done),
    perSession,
  });
});

/** Every load ever used for one exercise — the drill-down behind the PR board. */
router.get('/progress/:exercise', (req, res) => {
  const name = decodeURIComponent(req.params.exercise).toLowerCase();
  const points = history().flatMap((session) =>
    session.exercises
      .filter((exercise) => exercise.name.toLowerCase() === name && exercise.result)
      .map((exercise) => ({
        date: session.date,
        weightLb: exercise.result!.weightLb,
        sets: exercise.result!.sets,
        reps: exercise.result!.reps,
        rating: exercise.result!.rating,
      })),
  );

  res.json({ exercise: req.params.exercise, points });
});

// ─── The next session, from the rules ────────────────────────────────────────

router.get('/plan', (_req, res) => {
  const settings = readSettings();
  const done = history();
  const type = nextSessionType(done);

  res.json({ session: planSession(type, settings.catalogue, settings.inventory, done, today()) });
});

// ─── Import ──────────────────────────────────────────────────────────────────

router.post('/import', (req, res) => {
  const markdown: unknown = req.body?.markdown;

  if (typeof markdown !== 'string' || markdown.trim().length === 0) {
    res.status(400).json({ error: 'markdown must be the contents of the log' });
    return;
  }
  if (markdown.length > 2_000_000) {
    res.status(413).json({ error: 'that is larger than any log has any right to be' });
    return;
  }

  const settings = readSettings();
  const { sessions: parsed, notes } = parseVaultLog(
    markdown,
    settings.catalogue,
    settings.inventory,
  );

  // Re-importing the same log replaces what it covers rather than doubling it,
  // keyed on the date and type the entry claims.
  const existing = allSessions();
  const claimed = new Set(parsed.map((session) => `${session.date}|${session.type}`));
  const kept = existing.filter((session) => !claimed.has(`${session.date}|${session.type}`));

  const merged: Session[] = [...kept, ...parsed];
  writeSessions(merged);

  res.json({
    imported: parsed.length,
    replaced: existing.length - kept.length,
    notes: [...notes, ...parsed.flatMap((session) => session.importNotes ?? [])],
  });
});

const tool: ServerTool = { slug: 'trainer', router };
export default tool;
