import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson, dataFile } from '../../paths.js';
import { MAX_LOG_ENTRIES, type InboxEntry, type InboxStatus } from '../../shared/inbox.js';

/**
 * The record of every upload -- DATA_DIR/inbox/log.json.
 *
 * Loaded once into memory and written through on every mutation, capped at
 * MAX_LOG_ENTRIES oldest-first. A "received" row is written on the request
 * thread and a "settled" row from the background job that follows it -- both
 * go through this same in-memory array rather than a naive read-modify-write
 * of the file, so two uploads settling in the same tick can't clobber each
 * other.
 */

const FILE = 'inbox/log.json';
const INCOMING_DIR = 'inbox/incoming';

let entries: InboxEntry[] = readJson<InboxEntry[]>(FILE) ?? [];

function persist(): void {
  writeJson(FILE, entries);
}

export function received(
  id: string,
  filename: string,
  bytes: number,
  instructions: string,
): InboxEntry {
  const entry: InboxEntry = {
    id,
    at: Date.now(),
    settledAt: null,
    filename,
    bytes,
    instructions,
    status: 'working',
    destination: null,
    confidence: null,
    reasoning: '',
    reason: null,
  };
  entries = [entry, ...entries].slice(0, MAX_LOG_ENTRIES);
  persist();
  return entry;
}

export function settle(
  id: string,
  status: InboxStatus,
  fields: Partial<Pick<InboxEntry, 'destination' | 'confidence' | 'reasoning' | 'reason'>> = {},
): void {
  const entry = entries.find((candidate) => candidate.id === id);
  if (!entry) return;

  entry.status = status;
  entry.settledAt = Date.now();
  Object.assign(entry, fields);
  persist();
}

export function dismiss(id: string): boolean {
  const before = entries.length;
  entries = entries.filter((entry) => entry.id !== id);
  if (entries.length === before) return false;
  persist();
  return true;
}

export function recent(): InboxEntry[] {
  return entries;
}

export function incomingPath(id: string): string {
  return dataFile(path.join(INCOMING_DIR, id));
}

/**
 * Runs once at startup. A crash or restart mid-placement must never lose the
 * bytes or go unnoticed: any "working" row left over is marked failed (the
 * file is still sitting in incoming/), and any file in incoming/ with no
 * matching row gets one synthesised so it's visible rather than a silent disk
 * leak.
 */
function sweep(): void {
  let changed = false;

  for (const entry of entries) {
    if (entry.status === 'working') {
      entry.status = 'failed';
      entry.settledAt = Date.now();
      entry.reason = 'the server restarted before this was filed';
      changed = true;
    }
  }

  const known = new Set(entries.map((entry) => entry.id));
  let files: string[] = [];
  try {
    files = fs.readdirSync(dataFile(INCOMING_DIR));
  } catch {
    /* the directory doesn't exist yet -- nothing to sweep */
  }

  for (const id of files) {
    if (known.has(id)) continue;
    let bytes: number;
    try {
      bytes = fs.statSync(dataFile(path.join(INCOMING_DIR, id))).size;
    } catch {
      continue;
    }
    entries = [
      {
        id,
        at: Date.now(),
        settledAt: Date.now(),
        filename: id,
        bytes,
        instructions: '',
        status: 'failed',
        destination: null,
        confidence: null,
        reasoning: '',
        reason: 'found on disk with no record of how it got there',
      },
      ...entries,
    ];
    changed = true;
  }

  entries = entries.slice(0, MAX_LOG_ENTRIES);
  if (changed) persist();
}

sweep();
