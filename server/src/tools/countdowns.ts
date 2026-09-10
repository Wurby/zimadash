import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { readJson, writeJson } from '../paths.js';
import type { ServerTool } from './registry.js';
import {
  MAX_COUNTDOWNS,
  MAX_LABEL,
  isValidDay,
  sortViews,
  viewOf,
  type Countdown,
  type CountdownsFile,
} from '../shared/countdowns.js';

/**
 * Countdowns — everything under /api/tools/countdowns.
 *
 * Owns one file in DATA_DIR and reaches into nothing else. `event-driven`: the
 * data only changes when you change it, and the day count is derived on read.
 *
 * Same sharing model as Last Time: household rows (`ownerId: null`) plus
 * private ones. Unchecking shared hands ownership to whoever unchecked.
 */

const FILE = 'tool-countdowns.json';

const router = Router();

function load(): CountdownsFile {
  const file = readJson<CountdownsFile>(FILE);
  if (!file || !Array.isArray(file.items)) return { items: [] };

  return {
    items: file.items.map((item) => ({
      id: item.id,
      label: item.label,
      date: item.date,
      yearly: item.yearly ?? false,
      ownerId: item.ownerId === undefined ? undefined : item.ownerId,
    })) as Countdown[],
  };
}

function visibleTo(item: Countdown, userId: string): boolean {
  return item.ownerId === null || item.ownerId === userId;
}

function userId(req: { user?: { id: string } }): string {
  const id = req.user?.id;
  if (!id) throw new Error('requireAuth did not run');
  return id;
}

function respond(file: CountdownsFile, res: import('express').Response, uid: string): void {
  const now = Date.now();
  res.json({
    items: sortViews(
      file.items.filter((item) => visibleTo(item, uid)).map((item) => viewOf(item, now)),
    ),
  });
}

function cleanLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_LABEL) return null;
  return trimmed;
}

router.get('/', (req, res) => {
  respond(load(), res, userId(req));
});

router.post('/items', (req, res) => {
  const uid = userId(req);
  const file = load();
  const visible = file.items.filter((item) => visibleTo(item, uid));

  if (visible.length >= MAX_COUNTDOWNS) {
    res.status(409).json({ error: `at most ${MAX_COUNTDOWNS} countdowns` });
    return;
  }

  const label = cleanLabel(req.body?.label);
  if (!label) {
    res.status(400).json({ error: `label must be 1–${MAX_LABEL} characters` });
    return;
  }

  const date: unknown = req.body?.date;
  if (typeof date !== 'string' || !isValidDay(date)) {
    res.status(400).json({ error: 'date must be a real YYYY-MM-DD' });
    return;
  }

  const item: Countdown = {
    id: randomUUID(),
    label,
    date,
    yearly: req.body?.yearly === true,
    ownerId: req.body?.shared === true ? null : uid,
  };

  file.items.push(item);
  writeJson(FILE, file);
  respond(file, res, uid);
});

router.patch('/items/:id', (req, res) => {
  const uid = userId(req);
  const file = load();
  const item = file.items.find((candidate) => candidate.id === req.params.id);

  if (!item || !visibleTo(item, uid)) {
    res.status(404).json({ error: 'no such countdown' });
    return;
  }

  if (req.body?.label !== undefined) {
    const label = cleanLabel(req.body.label);
    if (!label) {
      res.status(400).json({ error: `label must be 1–${MAX_LABEL} characters` });
      return;
    }
    item.label = label;
  }

  if (req.body?.date !== undefined) {
    if (typeof req.body.date !== 'string' || !isValidDay(req.body.date)) {
      res.status(400).json({ error: 'date must be a real YYYY-MM-DD' });
      return;
    }
    item.date = req.body.date;
  }

  if (req.body?.yearly !== undefined) {
    if (typeof req.body.yearly !== 'boolean') {
      res.status(400).json({ error: 'yearly must be a boolean' });
      return;
    }
    item.yearly = req.body.yearly;
  }

  if (req.body?.shared !== undefined) {
    if (typeof req.body.shared !== 'boolean') {
      res.status(400).json({ error: 'shared must be a boolean' });
      return;
    }
    item.ownerId = req.body.shared ? null : uid;
  }

  writeJson(FILE, file);
  respond(file, res, uid);
});

router.delete('/items/:id', (req, res) => {
  const uid = userId(req);
  const file = load();
  const item = file.items.find((candidate) => candidate.id === req.params.id);

  if (!item || !visibleTo(item, uid)) {
    res.status(404).json({ error: 'no such countdown' });
    return;
  }

  const updated = { items: file.items.filter((candidate) => candidate.id !== req.params.id) };
  writeJson(FILE, updated);
  respond(updated, res, uid);
});

const tool: ServerTool = { slug: 'countdowns', router };
export default tool;
