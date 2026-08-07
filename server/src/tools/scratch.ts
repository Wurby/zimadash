import { Router } from 'express';
import { readJson, writeJson } from '../paths.js';
import type { ServerTool } from './registry.js';

/**
 * Scratch — a single shared note.
 *
 * This is the reference implementation of the tool contract: its own route
 * namespace, its own file in DATA_DIR, no reach into any other tool. It is the
 * `event-driven` tier in practice — nothing changes unless you change it.
 */

const FILE = 'tool-scratch.json';
const MAX_LENGTH = 20_000;

interface ScratchRecord {
  text: string;
  updatedAt: number;
}

const router = Router();

router.get('/', (_req, res) => {
  const record = readJson<ScratchRecord>(FILE);
  res.json(record ?? { text: '', updatedAt: 0 });
});

router.put('/', (req, res) => {
  const text: unknown = req.body?.text;

  if (typeof text !== 'string') {
    res.status(400).json({ error: 'text must be a string' });
    return;
  }
  if (text.length > MAX_LENGTH) {
    res.status(413).json({ error: `text must be at most ${MAX_LENGTH} characters` });
    return;
  }

  const record: ScratchRecord = { text, updatedAt: Date.now() };
  writeJson(FILE, record);
  res.json(record);
});

const tool: ServerTool = { slug: 'scratch', router };
export default tool;
