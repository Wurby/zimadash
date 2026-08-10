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

/** The one actually being worked through, if any. There is only ever one. */
export function activeSession(): Session | null {
  return allSessions().find((session) => session.status === 'active') ?? null;
}

/**
 * A session that has been built but not started.
 *
 * Kept separate from active on purpose: the model's plan is stored the moment
 * it's generated, so a reload doesn't throw away a two-minute wait — but a plan
 * sitting there is not a workout in progress, and the tile must not claim it is.
 */
export function plannedSession(): Session | null {
  return allSessions().find((session) => session.status === 'planned') ?? null;
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
