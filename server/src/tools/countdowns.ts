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
    })),
  };
}

function respond(file: CountdownsFile, res: import('express').Response): void {
  const now = Date.now();
  res.json({ items: sortViews(file.items.map((item) => viewOf(item, now))) });
}

function cleanLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_LABEL) return null;
  return trimmed;
}

router.get('/', (_req, res) => {
  respond(load(), res);
});

router.post('/items', (req, res) => {
  const file = load();

  if (file.items.length >= MAX_COUNTDOWNS) {
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
  };

  file.items.push(item);
  writeJson(FILE, file);
  respond(file, res);
});

router.patch('/items/:id', (req, res) => {
  const file = load();
  const item = file.items.find((candidate) => candidate.id === req.params.id);

  if (!item) {
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

  writeJson(FILE, file);
  respond(file, res);
});

router.delete('/items/:id', (req, res) => {
  const file = load();
  const next = file.items.filter((item) => item.id !== req.params.id);

  if (next.length === file.items.length) {
    res.status(404).json({ error: 'no such countdown' });
    return;
  }

  const updated = { items: next };
  writeJson(FILE, updated);
  respond(updated, res);
});

const tool: ServerTool = { slug: 'countdowns', router };
export default tool;
