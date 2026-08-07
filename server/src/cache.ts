import { getZimaStats } from './zimaStats.js';
import type { Stats } from './types.js';

// "Live" tier: system stats genuinely move second to second, so the server
// cache refreshes at the same cadence the client polls. See todos.md for the
// per-tool refresh tiers this will grow into.
const POLL_INTERVAL_MS = 5_000;

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
