import type { Request, Response } from 'express';
import { readJson, writeJson } from './paths.js';
import { BREAKPOINTS, COLUMNS, type Breakpoint, type Layout } from './shared/layout.js';

/**
 * The dashboard arrangement.
 *
 * One order shared by every device — packing is dense, so the same sequence
 * fills a phone and a wall display differently on its own. Sizes are stored per
 * surface instead, because six columns is three quarters of a phone and barely
 * a third of the wall: the same span is not the same tile.
 */

const FILE = 'layout.json';

/** The widest grid there is; nothing may be asked to span more than that. */
const MAX_SPAN = Math.max(...Object.values(COLUMNS));

/**
 * Sizes arrive as a bag keyed by item id and then by surface, so unlike the
 * flat order there is somewhere for junk to hide. Anything malformed rejects
 * the whole write rather than being quietly dropped — a layout that saved as
 * something other than what you picked is worse than one that refused.
 *
 * Returns null on bad input, which is distinct from an empty bag.
 */
export function parseSizes(raw: unknown): NonNullable<Layout['sizes']> | null {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;

  const sizes: NonNullable<Layout['sizes']> = {};

  for (const [id, bySurface] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof bySurface !== 'object' || bySurface === null || Array.isArray(bySurface))
      return null;

    const entry: Partial<Record<Breakpoint, number[]>> = {};
    for (const [surface, span] of Object.entries(bySurface as Record<string, unknown>)) {
      if (!BREAKPOINTS.includes(surface as Breakpoint)) return null;
      if (!Array.isArray(span) || span.length !== 2) return null;
      if (span.some((n) => !Number.isInteger(n) || n < 1 || n > MAX_SPAN)) return null;
      entry[surface as Breakpoint] = span as number[];
    }

    // An id whose every surface was reset carries no information, so it isn't
    // written back — that keeps the file sparse rather than accumulating husks.
    if (Object.keys(entry).length > 0) sizes[id] = entry;
  }

  return sizes;
}

export function handleReadLayout(_req: Request, res: Response): void {
  res.json(readJson<Layout>(FILE) ?? { version: 1, order: [], sizes: {} });
}

export function handleWriteLayout(req: Request, res: Response): void {
  const order = req.body?.order as unknown;
  if (!Array.isArray(order) || order.some((id) => typeof id !== 'string')) {
    res.status(400).json({ error: 'order must be an array of ids' });
    return;
  }

  const sizes = parseSizes(req.body?.sizes);
  if (!sizes) {
    res.status(400).json({ error: 'sizes must map item ids to per-surface [columns, rows]' });
    return;
  }

  const layout: Layout = { version: 1, order: order as string[], sizes };
  writeJson(FILE, layout);
  res.json(layout);
}
