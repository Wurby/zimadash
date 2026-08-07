import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { currentBuildId, readJson, writeJson } from './paths.js';

const PIN_FILE = 'auth.json';
const SESSION_FILE = 'session.json';

const MIN_PIN_LENGTH = 4;
const MAX_PIN_LENGTH = 64;

// The dashboard is reachable from the public internet behind nothing but a PIN,
// so failed attempts are throttled hard.
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

interface PinRecord {
  salt: string;
  hash: string;
  createdAt: number;
}

interface SessionRecord {
  buildId: string;
  secret: string;
}

// ─── PIN storage ─────────────────────────────────────────────────────────────

function hashPin(pin: string, salt: string): string {
  return crypto.scryptSync(pin.normalize('NFKC'), salt, 64).toString('hex');
}

export function isPinConfigured(): boolean {
  return readJson<PinRecord>(PIN_FILE) !== null;
}

export function setPin(pin: string): void {
  const salt = crypto.randomBytes(16).toString('hex');
  writeJson(PIN_FILE, {
    salt,
    hash: hashPin(pin, salt),
    createdAt: Date.now(),
  } satisfies PinRecord);
}

function verifyPin(pin: string): boolean {
  const record = readJson<PinRecord>(PIN_FILE);
  if (!record) return false;
  const candidate = Buffer.from(hashPin(pin, record.salt), 'hex');
  const expected = Buffer.from(record.hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

export function validatePinShape(pin: unknown): string | null {
  if (typeof pin !== 'string') return 'pin must be a string';
  if (pin.length < MIN_PIN_LENGTH) return `pin must be at least ${MIN_PIN_LENGTH} characters`;
  if (pin.length > MAX_PIN_LENGTH) return `pin must be at most ${MAX_PIN_LENGTH} characters`;
  return null;
}

// ─── Session secret ──────────────────────────────────────────────────────────

/**
 * The signing secret is derived per build, so shipping a new build invalidates
 * everything signed by the previous one while an ordinary restart does not.
 * ZIMADASH_SESSION_SECRET, if set, takes precedence.
 */
let sessionSecret = '';

export function initSessionSecret(): void {
  if (process.env.ZIMADASH_SESSION_SECRET) {
    sessionSecret = process.env.ZIMADASH_SESSION_SECRET;
    return;
  }

  const buildId = currentBuildId();
  const stored = readJson<SessionRecord>(SESSION_FILE);

  if (stored && stored.buildId === buildId) {
    sessionSecret = stored.secret;
    return;
  }

  sessionSecret = crypto.randomBytes(32).toString('hex');
  writeJson(SESSION_FILE, { buildId, secret: sessionSecret } satisfies SessionRecord);
}

// ─── Tokens ──────────────────────────────────────────────────────────────────

function sign(payload: string): string {
  return crypto.createHmac('sha256', sessionSecret).update(payload).digest('base64url');
}

export function issueToken(): string {
  const payload = Buffer.from(JSON.stringify({ iat: Date.now() })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function isTokenValid(token: string): boolean {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

// ─── Throttling ──────────────────────────────────────────────────────────────
//
// Two layers, because the obvious one cannot be trusted.
//
// Per-caller counting keys off a forwarded header, and the caller writes that
// header. Rotating it gives you a fresh budget every request, so it catches a
// careless attacker and nothing more. It is friction, not a boundary.
//
// The layer that actually holds is global and keyed off nothing: a running
// count of consecutive failures that decides how long the *next* attempt waits,
// and a rule that only one attempt is ever in flight. No header dodges either.
// Guessing degrades to a handful of tries a minute however many connections you
// open, and it survives a restart because the count lives in DATA_DIR.
//
// The delay grows rather than hard-locking on purpose. A hard global lock would
// let anyone on the internet lock the owner out by failing on purpose; waiting
// costs an attacker everything and the owner one pause, since a correct PIN
// clears the count.

const THROTTLE_FILE = 'throttle.json';

/** Spoofed keys must not grow the map without bound. */
const MAX_TRACKED_KEYS = 1_000;

/** Typos shouldn't cost anything. */
const FREE_ATTEMPTS = 4;
const BASE_DELAY_MS = 250;
const MAX_DELAY_MS = 10_000;

const attempts = new Map<string, { count: number; lockedUntil: number }>();

/** Only one login is ever processed at a time, so concurrency buys nothing. */
let loginInFlight = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readFailures(): number {
  return readJson<{ failures: number }>(THROTTLE_FILE)?.failures ?? 0;
}

function writeFailures(failures: number): void {
  writeJson(THROTTLE_FILE, { failures });
}

function delayFor(failures: number): number {
  if (failures <= FREE_ATTEMPTS) return 0;
  return Math.min(BASE_DELAY_MS * 2 ** (failures - FREE_ATTEMPTS), MAX_DELAY_MS);
}

function clientKey(req: Request): string {
  // Behind the tunnel every request arrives from localhost, so a forwarded
  // header is the only thing distinguishing callers — and the caller sets it.
  const forwarded = req.headers['cf-connecting-ip'] ?? req.headers['x-forwarded-for'];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return (value?.split(',')[0].trim() || req.ip) ?? 'unknown';
}

function lockRemaining(key: string): number {
  const entry = attempts.get(key);
  if (!entry) return 0;
  return Math.max(0, entry.lockedUntil - Date.now());
}

function recordFailure(key: string): void {
  if (!attempts.has(key) && attempts.size >= MAX_TRACKED_KEYS) {
    // Map iteration is insertion-ordered, so this drops the stalest key.
    const oldest = attempts.keys().next().value;
    if (oldest !== undefined) attempts.delete(oldest);
  }

  const entry = attempts.get(key) ?? { count: 0, lockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= MAX_ATTEMPTS) {
    entry.lockedUntil = Date.now() + LOCKOUT_MS;
    entry.count = 0;
  }
  attempts.set(key, entry);
}

// ─── Route handlers ──────────────────────────────────────────────────────────

/** Unauthenticated — tells the client whether to show setup or the PIN pad. */
export function handleStatus(_req: Request, res: Response): void {
  res.json({ configured: isPinConfigured() });
}

/** Unauthenticated, but only usable once: sets the PIN on first ever visit. */
export function handleSetup(req: Request, res: Response): void {
  if (isPinConfigured()) {
    res.status(409).json({ error: 'a pin is already set' });
    return;
  }
  const problem = validatePinShape(req.body?.pin);
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }
  setPin(req.body.pin);
  res.json({ token: issueToken() });
}

export async function handleLogin(req: Request, res: Response): Promise<void> {
  // Refuse rather than queue. Queuing would let an attacker park a thousand
  // connections and get a thousand guesses for one wait.
  if (loginInFlight) {
    res.status(429).json({ error: 'too many attempts' });
    return;
  }
  loginInFlight = true;

  try {
    const key = clientKey(req);
    const remaining = lockRemaining(key);
    if (remaining > 0) {
      res.status(429).json({ error: 'too many attempts', retryAfterMs: remaining });
      return;
    }

    if (!isPinConfigured()) {
      res.status(409).json({ error: 'no pin has been set yet' });
      return;
    }

    const failures = readFailures();
    const wait = delayFor(failures);
    if (wait > 0) await sleep(wait);

    if (typeof req.body?.pin !== 'string' || !verifyPin(req.body.pin)) {
      recordFailure(key);
      writeFailures(failures + 1);
      res.status(401).json({ error: 'incorrect pin' });
      return;
    }

    // Knowing the PIN clears the debt, so the owner never inherits an
    // attacker's backoff for more than a single attempt.
    attempts.delete(key);
    writeFailures(0);
    res.json({ token: issueToken() });
  } catch {
    res.status(500).json({ error: 'login failed' });
  } finally {
    loginInFlight = false;
  }
}

/** Gate for everything else under /api. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token || !isTokenValid(token)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
}
