import { getZimaStats } from './zimaStats.js';
import type { Stats } from './types.js';
import { intervalFor, type RefreshTier } from './shared/tiers.js';

// System stats genuinely move second to second, so they sit on the `live` tier.
// The interval comes from shared/tiers.ts — the same module the client reads —
// so the cache can never end up slower than the clients polling it.
const TIER: RefreshTier = 'live';
const POLL_INTERVAL_MS = intervalFor(TIER) ?? 5_000;

interface CacheEntry {
  data: Stats | null;
  error: string | null;
  fetchedAt: number | null;
}

const cache = new Map<string, CacheEntry>();

async function pollZima(): Promise<void> {
  try {
    cache.set('zima', { data: await getZimaStats(), error: null, fetchedAt: Date.now() });
  } catch (err) {
    cache.set('zima', { data: null, error: (err as Error).message, fetchedAt: Date.now() });
  }
}

export function startPolling(): void {
  pollZima();
  setInterval(pollZima, POLL_INTERVAL_MS);
}

export function getCachedStats(hostId: string): CacheEntry | undefined {
  return cache.get(hostId);
}

export function getAllHostIds(): string[] {
  return ['zima'];
}
