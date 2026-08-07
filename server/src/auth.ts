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

const attempts = new Map<string, { count: number; lockedUntil: number }>();

function clientKey(req: Request): string {
  // Behind the Cloudflare Tunnel every request arrives from localhost, so the
  // forwarded header is the only thing that distinguishes callers. It is
  // spoofable — treat this as friction, not as a security boundary.
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

export function handleLogin(req: Request, res: Response): void {
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

  if (typeof req.body?.pin !== 'string' || !verifyPin(req.body.pin)) {
    recordFailure(key);
    res.status(401).json({ error: 'incorrect pin' });
    return;
  }

  attempts.delete(key);
  res.json({ token: issueToken() });
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
