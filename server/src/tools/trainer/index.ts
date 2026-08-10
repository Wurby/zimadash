import { Router } from 'express';
import type { ServerTool } from '../registry.js';
import {
  IMPLEMENTS,
  RATINGS,
  currentStreak,
  dayKey,
  habitGrid,
  loadLadder,
  nextSessionType,
  personalRecords,
  volumeOf,
  weekKey,
  weeklySummaries,
  type ExerciseGuide,
  type Implement,
  type Session,
} from '../../shared/trainer.js';
import { readSettings, writeSettings, type TrainerSettings } from './settings.js';
import {
  activeSession,
  allSessions,
  findSession,
  history,
  plannedSession,
  removeSession,
  upsertSession,
  writeSessions,
} from './storage.js';
import { parseVaultLog } from './importVault.js';
import { planSession } from './planner.js';
import { explainExercise, planWithModel } from './brain.js';
import { findGuide, policyHash, saveGuide } from './guides.js';
import { speechCapability, synthesise } from './speech.js';

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
  const active = sessions.find((session) => session.status === 'active') ?? null;

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

  // A plan the model built earlier today still stands — regenerating it would
  // throw away a two-minute wait and might quietly hand back a different
  // workout than the one on screen a moment ago.
  const stored = plannedSession();
  if (stored && stored.date === today() && stored.type === type) {
    res.json({ session: stored, plannedBy: stored.plannedBy });
    return;
  }
  if (stored) removeSession(stored.id);

  res.json({
    session: planSession(type, settings.catalogue, settings.inventory, done, today()),
    plannedBy: 'rules',
  });
});

/**
 * Upgrade today's plan using the model.
 *
 * Slow — a process spawn plus model time — so the Session tab shows the rules
 * plan immediately and swaps this in when it lands. The result is stored, so a
 * reload keeps it.
 */
router.post('/plan/model', async (_req, res) => {
  if (activeSession()) {
    res.status(409).json({ error: 'a session is already running' });
    return;
  }

  const settings = readSettings();
  const done = history();
  const type = nextSessionType(done);

  try {
    const { session, reasoning } = await planWithModel(
      type,
      settings.policy,
      settings.catalogue,
      settings.inventory,
      done,
      today(),
    );

    const stale = plannedSession();
    if (stale) removeSession(stale.id);
    upsertSession(session);

    res.json({ session, reasoning, plannedBy: 'model' });
  } catch (err) {
    // Never substituted silently — the rules plan is already on screen, and the
    // caller is told plainly that this is what it is.
    res.status(503).json({
      error: (err as Error).message,
      fallback: 'rules',
    });
  }
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

// ─── Running a session ───────────────────────────────────────────────────────

/**
 * Results are written the moment they're tapped, not at the end.
 *
 * The session only *counts* as finished when you finish it, but a phone sleeps
 * between sets and a reload has to put you back where you were. Persisting per
 * exercise is the difference between losing a workout and not.
 */

function loadSession(id: string, res: import('express').Response): Session | null {
  const session = findSession(id);
  if (!session) {
    res.status(404).json({ error: 'no such session' });
    return null;
  }
  return session;
}

/** Start the planned session, or adopt one already in progress. */
router.post('/sessions', (_req, res) => {
  const existing = activeSession();
  if (existing) {
    res.json({ session: existing });
    return;
  }

  const done = history();
  const type = nextSessionType(done);

  // Whatever is on screen is what starts. If the model built today's plan, that
  // is the one — starting a freshly-computed rules session instead would be a
  // different workout than the one just read.
  const stored = plannedSession();
  const session =
    stored && stored.date === today() && stored.type === type
      ? stored
      : (() => {
          const settings = readSettings();
          if (stored) removeSession(stored.id);
          return planSession(type, settings.catalogue, settings.inventory, done, today());
        })();

  session.status = 'active';
  session.startedAt = Date.now();
  upsertSession(session);
  res.json({ session });
});

router.get('/sessions/active', (_req, res) => {
  res.json({ session: activeSession() });
});

/** Record how an exercise went and move to the next. */
router.patch('/sessions/:id/exercises/:index', (req, res) => {
  const session = loadSession(req.params.id, res);
  if (!session) return;

  const index = Number(req.params.index);
  const exercise = session.exercises[index];
  if (!exercise) {
    res.status(404).json({ error: 'no such exercise in this session' });
    return;
  }

  const { rating, weightLb, sets, reps, note, skipped, skipReason } = req.body ?? {};

  if (skipped === true) {
    exercise.result = {
      weightLb: exercise.prescribed.weightLb,
      sets: 0,
      reps: 0,
      rating: 'hard',
      skipped: true,
      skipReason: typeof skipReason === 'string' ? skipReason.slice(0, 300) : undefined,
    };
  } else {
    if (!RATINGS.includes(rating)) {
      res.status(400).json({ error: `rating must be one of ${RATINGS.join(', ')}` });
      return;
    }

    const number = (value: unknown, fallback: number) =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;

    exercise.result = {
      weightLb: number(weightLb, exercise.prescribed.weightLb),
      sets: number(sets, exercise.prescribed.sets),
      reps: number(reps, exercise.prescribed.reps),
      rating,
      note: typeof note === 'string' && note.trim() ? note.slice(0, 300) : undefined,
    };
  }

  // Move to the first exercise that still has no result, so going back to
  // correct one doesn't drag you through the rest again.
  const pending = session.exercises.findIndex((candidate) => candidate.result === null);
  session.cursor = pending === -1 ? session.exercises.length - 1 : pending;

  upsertSession(session);
  res.json({ session, allDone: pending === -1 });
});

/** What could stand in for this exercise. */
router.get('/sessions/:id/alternatives/:index', (req, res) => {
  const session = loadSession(req.params.id, res);
  if (!session) return;

  const index = Number(req.params.index);
  const exercise = session.exercises[index];
  if (!exercise) {
    res.status(404).json({ error: 'no such exercise in this session' });
    return;
  }

  const settings = readSettings();
  const inSession = new Set(session.exercises.map((candidate) => candidate.name));

  const candidates = settings.catalogue.filter(
    (definition) =>
      definition.days.includes(session.type) &&
      !inSession.has(definition.name) &&
      !definition.complex,
  );

  // Swapping out knee work is usually because something hurt, so the low-stress
  // options the brief names come first rather than another squat variant.
  const ranked = exercise.kneeLoaded
    ? [
        ...candidates.filter((definition) => !definition.kneeLoaded),
        ...candidates.filter((definition) => definition.kneeLoaded),
      ]
    : candidates;

  res.json({
    alternatives: ranked.slice(0, 6).map((definition) => ({
      name: definition.name,
      implement: definition.implement,
      kind: definition.kind,
      kneeLoaded: definition.kneeLoaded ?? false,
      note: definition.note,
    })),
  });
});

/** Replace an exercise in place, keeping your position in the session. */
router.post('/sessions/:id/exercises/:index/swap', (req, res) => {
  const session = loadSession(req.params.id, res);
  if (!session) return;

  const index = Number(req.params.index);
  if (!session.exercises[index]) {
    res.status(404).json({ error: 'no such exercise in this session' });
    return;
  }

  const settings = readSettings();
  const definition = settings.catalogue.find((candidate) => candidate.name === req.body?.name);
  if (!definition) {
    res.status(400).json({ error: 'that exercise is not in the catalogue' });
    return;
  }

  const done = history();
  const replacement = planSession(
    session.type,
    [definition],
    settings.inventory,
    done,
    session.date,
  ).exercises[0];

  if (!replacement) {
    res.status(500).json({ error: 'could not build a replacement' });
    return;
  }

  session.exercises[index] = replacement;
  upsertSession(session);
  res.json({ session });
});

/** Add one on the fly — the log shows this happening, so it has to be possible. */
router.post('/sessions/:id/exercises', (req, res) => {
  const session = loadSession(req.params.id, res);
  if (!session) return;

  const settings = readSettings();
  const definition = settings.catalogue.find((candidate) => candidate.name === req.body?.name);
  if (!definition) {
    res.status(400).json({ error: 'that exercise is not in the catalogue' });
    return;
  }

  const added = planSession(session.type, [definition], settings.inventory, history(), session.date)
    .exercises[0];

  if (!added) {
    res.status(500).json({ error: 'could not build that exercise' });
    return;
  }

  session.exercises.push(added);
  session.cursor = session.exercises.length - 1;
  upsertSession(session);
  res.json({ session });
});

router.post('/sessions/:id/finish', (req, res) => {
  const session = loadSession(req.params.id, res);
  if (!session) return;

  // Anything never reached is recorded as skipped rather than silently dropped
  // — a session that says six exercises and logs four should say why.
  for (const exercise of session.exercises) {
    if (exercise.result === null) {
      exercise.result = {
        weightLb: exercise.prescribed.weightLb,
        sets: 0,
        reps: 0,
        rating: 'hard',
        skipped: true,
        skipReason: 'not reached',
      };
    }
  }

  session.status = 'done';
  session.finishedAt = Date.now();
  upsertSession(session);

  const before = history().filter((candidate) => candidate.id !== session.id);
  const previous = new Set(personalRecords(before).map((record) => record.exercise));
  const fresh = personalRecords(history()).filter(
    (record) => record.date === session.date && !previous.has(record.exercise),
  );

  res.json({
    session,
    records: personalRecords(history()).filter((record) => record.date === session.date),
    newExercises: fresh.length,
  });
});

router.delete('/sessions/:id', (req, res) => {
  const session = loadSession(req.params.id, res);
  if (!session) return;
  if (session.status === 'done') {
    res.status(409).json({ error: 'that one is already logged' });
    return;
  }

  removeSession(session.id);
  res.json({ ok: true });
});

// ─── Detailed guidance ───────────────────────────────────────────────────────

/**
 * The long-form how-to for one movement.
 *
 * Generated once and cached, because it describes the exercise rather than
 * today's session — so the first tap waits and every one after is instant.
 * `?refresh=1` writes a new one, for when the old reads badly.
 */
router.get('/exercises/:name/guide', async (req, res) => {
  const settings = readSettings();
  const name = decodeURIComponent(req.params.name);

  const definition = settings.catalogue.find((entry) => entry.name === name);
  if (!definition) {
    res.status(404).json({ error: 'that exercise is not in the catalogue' });
    return;
  }

  if (req.query.refresh !== '1') {
    const cached = findGuide(name, settings.policy);
    if (cached) {
      res.json({ guide: cached, cached: true });
      return;
    }
  }

  try {
    const written = await explainExercise(definition, settings.policy, settings.inventory);
    const guide: ExerciseGuide = {
      exercise: name,
      ...written,
      policyHash: policyHash(settings.policy),
      at: Date.now(),
    };

    saveGuide(guide);
    res.json({ guide, cached: false });
  } catch (err) {
    // No rules fallback exists for prose, so this is simply unavailable — the
    // short cue is still on screen and remains the thing you actually need.
    res.status(503).json({ error: (err as Error).message });
  }
});

// ─── Voice ───────────────────────────────────────────────────────────────────

router.get('/speech', (_req, res) => {
  res.json(speechCapability());
});

router.post('/speech', async (req, res) => {
  const text: unknown = req.body?.text;

  if (typeof text !== 'string' || text.trim().length === 0) {
    res.status(400).json({ error: 'text is required' });
    return;
  }
  if (text.length > 2_000) {
    res.status(413).json({ error: 'that is more than anyone needs read aloud at once' });
    return;
  }

  try {
    const audio = await synthesise(text);
    res.setHeader('Content-Type', 'audio/wav');
    // Keyed on the text, so the same cue is never fetched twice in a session.
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(audio);
  } catch (err) {
    res.status(503).json({ error: (err as Error).message });
  }
});

const tool: ServerTool = { slug: 'trainer', router };
export default tool;
