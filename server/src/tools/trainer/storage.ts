import { readJson, writeJson } from '../../paths.js';
import type { Session } from '../../shared/trainer.js';

/**
 * Session storage.
 *
 * One file, oldest first. The brief's fortnight window and monthly archive
 * files were workarounds for living in a markdown vault — a real store makes
 * both moot, so they are deliberately not ported. If this ever grows enough to
 * matter, partition it then and not before.
 */

const FILE = 'trainer/sessions.json';

interface SessionsFile {
  sessions: Session[];
}

export function allSessions(): Session[] {
  const file = readJson<SessionsFile>(FILE);
  if (!file || !Array.isArray(file.sessions)) return [];
  return [...file.sessions].sort((a, b) => a.date.localeCompare(b.date));
}

export function writeSessions(sessions: Session[]): void {
  writeJson(FILE, { sessions: [...sessions].sort((a, b) => a.date.localeCompare(b.date)) });
}

export function findSession(id: string): Session | null {
  return allSessions().find((session) => session.id === id) ?? null;
}

/** The one in progress, if any. There is only ever one. */
export function activeSession(): Session | null {
  return allSessions().find((session) => session.status !== 'done') ?? null;
}

export function upsertSession(session: Session): Session[] {
  const sessions = allSessions().filter((candidate) => candidate.id !== session.id);
  sessions.push(session);
  writeSessions(sessions);
  return sessions;
}

export function removeSession(id: string): Session[] {
  const sessions = allSessions().filter((session) => session.id !== id);
  writeSessions(sessions);
  return sessions;
}

/** Completed sessions, oldest first — what every derived figure reads. */
export function history(): Session[] {
  return allSessions().filter((session) => session.status === 'done');
}
