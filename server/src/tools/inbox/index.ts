import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { ServerTool } from '../registry.js';
import { MAX_FILENAME, MAX_INSTRUCTIONS } from '../../shared/inbox.js';
import { decidePlacement, type Decision } from './brain.js';
import { inboxRoot, resolveWithin, forceExtension, uncollided, place } from './root.js';
import { received, settle as settleEntry, dismiss, recent, incomingPath } from './log.js';

/**
 * Everything under /api/tools/inbox.
 *
 * Fire-and-forget by design: POST /upload streams the file to DATA_DIR,
 * responds 202 the moment it's safely on disk, and files it in the
 * background. The upload is staged in DATA_DIR -- not os.tmpdir() like a
 * calorie photo -- because this file IS the payload, not ephemeral input; it
 * has to survive a dead brain, a full disk, or the box rebooting mid-job. See
 * log.ts's startup sweep for what happens if it does.
 */

const router = Router();

// The Cloudflare Tunnel this box sits behind caps request bodies at 100MB on
// the free plan. Staying comfortably under it means a rejection is always
// ours -- a legible 413 -- rather than an opaque tunnel error.
const MAX_BYTES = 64 * 1024 * 1024;

const UNSORTED = 'Unsorted';

function decodeHeader(value: string | string[] | undefined): string {
  if (typeof value !== 'string') return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return '';
  }
}

function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) < 0x20) return true;
  }
  return false;
}

function safeFilename(name: string): string {
  const base = path
    .basename(name)
    .split('')
    .filter((ch) => !hasControlChar(ch))
    .join('')
    .trim();
  return base.slice(0, MAX_FILENAME) || 'upload';
}

/**
 * Files one upload after it's already safely on disk. Must never reject --
 * this runs detached from any request, and an uncaught rejection here would
 * be a silently lost failure, exactly what this tool exists to avoid.
 */
async function settleUpload(
  id: string,
  filename: string,
  bytes: number,
  instructions: string,
): Promise<void> {
  const root = inboxRoot();
  const staged = incomingPath(id);

  if (!root) {
    settleEntry(id, 'failed', { reason: 'ZIMADASH_INBOX_ROOT is not configured' });
    return;
  }

  let decision: Decision;
  try {
    decision = await decidePlacement(root, filename, bytes, staged, instructions);
  } catch (err) {
    settleEntry(id, 'failed', {
      reason: err instanceof Error ? err.message : 'the inbox brain failed',
    });
    return;
  }

  const lowConfidence = decision.confidence < 0.6;
  const wantsUnsorted = lowConfidence || decision.folder.trim() === UNSORTED;

  const folder = wantsUnsorted ? UNSORTED : decision.folder;
  const proposedName = wantsUnsorted ? filename : forceExtension(decision.filename, filename);

  const resolved = resolveWithin(root, folder, proposedName);
  if (!resolved) {
    // The model's own choice failed validation -- fall back to Unsorted with
    // the original filename rather than trust anything else it said.
    const fallback = resolveWithin(root, UNSORTED, filename);
    if (!fallback) {
      settleEntry(id, 'failed', { reason: 'could not resolve a safe path, even into Unsorted' });
      return;
    }
    try {
      place(staged, uncollided(fallback));
    } catch (err) {
      settleEntry(id, 'failed', {
        reason: err instanceof Error ? err.message : 'could not write the file',
      });
      return;
    }
    settleEntry(id, 'unsorted', {
      destination: path.relative(root, fallback),
      confidence: decision.confidence,
      reasoning: decision.reasoning,
      reason: 'the chosen path was not safe to write to',
    });
    return;
  }

  const target = uncollided(resolved);
  try {
    place(staged, target);
  } catch (err) {
    settleEntry(id, 'failed', {
      reason: err instanceof Error ? err.message : 'could not write the file',
    });
    return;
  }

  settleEntry(id, wantsUnsorted ? 'unsorted' : 'placed', {
    destination: path.relative(root, target),
    confidence: decision.confidence,
    reasoning: decision.reasoning,
    reason: wantsUnsorted ? decision.reasoning || 'low confidence' : null,
  });
}

router.post('/upload', (req, res) => {
  const contentLength = Number(req.headers['content-length'] ?? 0);
  if (contentLength > MAX_BYTES) {
    res.status(413).json({ error: `files over ${MAX_BYTES / (1024 * 1024)}MB are not accepted` });
    return;
  }

  const rawFilename = decodeHeader(req.headers['x-inbox-filename']);
  if (!rawFilename) {
    res.status(400).json({ error: 'X-Inbox-Filename is required' });
    return;
  }
  const filename = safeFilename(rawFilename);
  const instructions = decodeHeader(req.headers['x-inbox-instructions'])
    .trim()
    .slice(0, MAX_INSTRUCTIONS);

  const id = randomUUID();
  const staged = incomingPath(id);
  fs.mkdirSync(path.dirname(staged), { recursive: true, mode: 0o700 });

  const out = fs.createWriteStream(staged, { mode: 0o600 });
  let bytes = 0;
  let aborted = false;

  function abort(status: number, error: string): void {
    if (aborted) return;
    aborted = true;
    req.destroy();
    out.destroy();
    fs.rm(staged, { force: true }, () => {});
    if (!res.headersSent) res.status(status).json({ error });
  }

  req.on('data', (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > MAX_BYTES) abort(413, `files over ${MAX_BYTES / (1024 * 1024)}MB are not accepted`);
  });

  req.on('error', () => abort(400, 'upload failed'));
  out.on('error', () => abort(500, 'could not save the upload'));

  out.on('finish', () => {
    if (aborted) return;
    if (bytes === 0) {
      fs.rm(staged, { force: true }, () => {});
      res.status(400).json({ error: 'empty upload' });
      return;
    }

    received(id, filename, bytes, instructions);
    res.status(202).json({ id, filename, bytes, status: 'working' });

    void settleUpload(id, filename, bytes, instructions).catch(() => {
      settleEntry(id, 'failed', { reason: 'an unexpected error occurred while filing this' });
    });
  });

  req.pipe(out);
});

router.get('/', (_req, res) => {
  res.json({ configured: inboxRoot() !== null, entries: recent() });
});

router.delete('/:id', (req, res) => {
  if (!dismiss(req.params.id)) {
    res.status(404).json({ error: 'no such entry' });
    return;
  }
  res.json({ ok: true });
});

const tool: ServerTool = { slug: 'inbox', router };
export default tool;
