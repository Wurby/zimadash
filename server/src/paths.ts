import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentUser } from './context.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Persistent state lives OUTSIDE the deployed artifact.
 *
 * `scripts/deploy.sh` rsyncs with `--delete`, so the deploy directory is wiped
 * to match the local build on every deploy. Anything written in here — the PIN,
 * the session secret, and every future tool's data — must never live there.
 */
export const DATA_DIR = process.env.ZIMADASH_DATA_DIR
  ? path.resolve(process.env.ZIMADASH_DATA_DIR)
  : path.join(os.homedir(), 'zimadash-data');

/** Artifact root: server/dist/ -> ../.. */
const ARTIFACT_ROOT = path.resolve(__dirname, '../..');

export function ensureDataDir(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
}

export function dataFile(name: string): string {
  return path.join(DATA_DIR, name);
}

/**
 * A file that belongs to the signed-in user.
 *
 * Household state (scratch, weather, actions, the inbox log, Piper voices)
 * stays at the DATA_DIR root. Anything personal — calories, trainer, layout —
 * lives under `users/<id>/` so two PINs cannot read each other's records.
 */
export function personal(name: string): string {
  return path.posix.join('users', currentUser().id, name);
}

/**
 * Move the pre-user files into the first (owner) user's folder.
 *
 * Runs once: if the destination already exists we leave both sides alone,
 * because a second pass would clobber a user who has already been using the
 * new layout. Household files are not in this list.
 */
export function migratePersonalData(ownerId: string): void {
  const prefix = path.join('users', ownerId);

  moveIfExists('layout.json', path.join(prefix, 'layout.json'));
  moveIfExists('calories', path.join(prefix, 'calories'));

  for (const name of ['settings.json', 'sessions.json', 'guides.json']) {
    moveIfExists(path.join('trainer', name), path.join(prefix, 'trainer', name));
  }
}

function moveIfExists(from: string, to: string): void {
  const src = dataFile(from);
  const dest = dataFile(to);
  if (!fs.existsSync(src) || fs.existsSync(dest)) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
  fs.renameSync(src, dest);
}

export function readJson<T>(name: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(dataFile(name), 'utf8')) as T;
  } catch {
    return null;
  }
}

export function writeJson(name: string, value: unknown): void {
  ensureDataDir();
  const target = dataFile(name);
  // `name` may be nested — a tool with a lot of files wants its own folder, and
  // ensureDataDir only makes DATA_DIR itself.
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });

  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, target);
}

/** Names of the files directly inside a DATA_DIR subdirectory. */
export function listDataFiles(dir: string): string[] {
  try {
    return fs.readdirSync(dataFile(dir));
  } catch {
    return [];
  }
}

/**
 * Identifies the running build. `scripts/deploy.sh` writes DEPLOYED into the
 * artifact root on every deploy, so this string changes exactly when a new
 * build lands — which is what invalidates existing sessions.
 */
export function currentBuildId(): string {
  try {
    return fs.readFileSync(path.join(ARTIFACT_ROOT, 'DEPLOYED'), 'utf8').trim();
  } catch {
    return 'dev';
  }
}
