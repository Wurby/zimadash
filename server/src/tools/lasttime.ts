import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { readJson, writeJson } from '../paths.js';
import type { ServerTool } from './registry.js';
import {
  DEFAULT_INTERVAL_DAYS,
  MAX_INTERVAL_DAYS,
  MAX_ITEMS,
  MAX_LABEL,
  MIN_INTERVAL_DAYS,
  viewOf,
  type LastTimeFile,
  type LastTimeItem,
} from '../shared/lasttime.js';

/**
 * Last time I… — everything under /api/tools/lasttime.
 *
 * Owns one file in DATA_DIR and reaches into nothing else. The `event-driven`
 * tier in practice: nothing here changes unless you tap it.
 *
 * Every derived figure — the effective interval, how overdue a thing is — is
 * computed here and sent down whole, so the tile renders what it is given and
 * the two sides can't disagree about what "overdue" means.
 */

const FILE = 'tool-lasttime.json';

const router = Router();

function load(): LastTimeFile {
  const file = readJson<LastTimeFile>(FILE);
  if (!file || !Array.isArray(file.items)) return { items: [] };

  // Absorb older records as optional fields with defaults rather than
  // migrating — the same approach layout.json takes.
  return {
    items: file.items.map((item) => ({
      id: item.id,
      label: item.label,
      defaultDays: item.defaultDays ?? DEFAULT_INTERVAL_DAYS,
      overrideDays: item.overrideDays ?? null,
      onTile: item.onTile ?? true,
      history: Array.isArray(item.history) ? item.history : [],
    })),
  };
}

function save(file: LastTimeFile): void {
  writeJson(FILE, file);
}

function respond(file: LastTimeFile, res: import('express').Response): void {
  const now = Date.now();
  res.json({ items: file.items.map((item) => viewOf(item, now)) });
}

/** A label that is a non-empty string within the length cap, or null. */
function cleanLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_LABEL) return null;
  return trimmed;
}

/** A finite interval inside the allowed range, or null. */
function cleanInterval(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < MIN_INTERVAL_DAYS || value > MAX_INTERVAL_DAYS) return null;
  return Math.round(value * 100) / 100;
}

router.get('/', (_req, res) => {
  respond(load(), res);
});

router.post('/items', (req, res) => {
  const file = load();

  if (file.items.length >= MAX_ITEMS) {
    res.status(409).json({ error: `at most ${MAX_ITEMS} items` });
    return;
  }

  const label = cleanLabel(req.body?.label);
  if (!label) {
    res.status(400).json({ error: `label must be 1–${MAX_LABEL} characters` });
    return;
  }

  const defaultDays =
    req.body?.defaultDays === undefined
      ? DEFAULT_INTERVAL_DAYS
      : cleanInterval(req.body.defaultDays);

  if (defaultDays === null) {
    res
      .status(400)
      .json({ error: `defaultDays must be between ${MIN_INTERVAL_DAYS} and ${MAX_INTERVAL_DAYS}` });
    return;
  }

  const item: LastTimeItem = {
    id: randomUUID(),
    label,
    defaultDays,
    overrideDays: null,
    onTile: true,
    history: [],
  };

  file.items.push(item);
  save(file);
  respond(file, res);
});

router.patch('/items/:id', (req, res) => {
  const file = load();
  const item = file.items.find((candidate) => candidate.id === req.params.id);

  if (!item) {
    res.status(404).json({ error: 'no such item' });
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

  if (req.body?.defaultDays !== undefined) {
    const days = cleanInterval(req.body.defaultDays);
    if (days === null) {
      res.status(400).json({ error: 'defaultDays out of range' });
      return;
    }
    item.defaultDays = days;
  }

  // Explicitly nullable: sending null is how you unpin and hand the interval
  // back to whatever history has learned.
  if (req.body?.overrideDays !== undefined) {
    if (req.body.overrideDays === null) {
      item.overrideDays = null;
    } else {
      const days = cleanInterval(req.body.overrideDays);
      if (days === null) {
        res.status(400).json({ error: 'overrideDays out of range' });
        return;
      }
      item.overrideDays = days;
    }
  }

  if (req.body?.onTile !== undefined) {
    if (typeof req.body.onTile !== 'boolean') {
      res.status(400).json({ error: 'onTile must be a boolean' });
      return;
    }
    item.onTile = req.body.onTile;
  }

  save(file);
  respond(file, res);
});

router.delete('/items/:id', (req, res) => {
  const file = load();
  const next = file.items.filter((item) => item.id !== req.params.id);

  if (next.length === file.items.length) {
    res.status(404).json({ error: 'no such item' });
    return;
  }

  const updated = { items: next };
  save(updated);
  respond(updated, res);
});

/** The whole point of the tool: record that you just did the thing. */
router.post('/items/:id/tap', (req, res) => {
  const file = load();
  const item = file.items.find((candidate) => candidate.id === req.params.id);

  if (!item) {
    res.status(404).json({ error: 'no such item' });
    return;
  }

  item.history.push(Date.now());
  save(file);
  respond(file, res);
});

/**
 * Undo the most recent tap.
 *
 * A mis-tap writes a timestamp that is now wrong and takes the real one with
 * it, so this has to exist. It only ever removes the newest entry — there is no
 * editing history by hand, because the interval is learned from it and a
 * hand-tuned past would quietly teach it a lie.
 */
router.post('/items/:id/undo', (req, res) => {
  const file = load();
  const item = file.items.find((candidate) => candidate.id === req.params.id);

  if (!item) {
    res.status(404).json({ error: 'no such item' });
    return;
  }
  if (item.history.length === 0) {
    res.status(409).json({ error: 'nothing to undo' });
    return;
  }

  item.history.sort((a, b) => a - b);
  item.history.pop();
  save(file);
  respond(file, res);
});

const tool: ServerTool = { slug: 'lasttime', router };
export default tool;
