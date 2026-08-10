/**
 * Refresh tiers — imported by BOTH the server and the frontend.
 *
 * The frontend reaches this through the `@shared/*` alias (tsconfig.app.json
 * paths + vite.config.ts resolve.alias). Keep everything in `shared/` free of
 * Node built-ins and browser globals so both sides can bundle it.
 *
 * There is no single global refresh interval. Data is polled at the cadence it
 * actually changes, and a server cache must never be slower than the client
 * tier it feeds — otherwise the client re-fetches values that cannot have
 * changed. Both sides read these numbers, so they cannot drift apart.
 */

export type RefreshTier = 'live' | 'ambient' | 'slow' | 'event-driven';

/** Poll interval per tier, in milliseconds. `null` means never on a timer. */
export const TIER_INTERVAL_MS: Record<RefreshTier, number | null> = {
  /** Anything genuinely in motion — system stats. */
  live: 5_000,
  /** A minute stale is fine — elapsed-time readouts, calendar. */
  ambient: 60_000,
  /**
   * A quarter hour stale is fine — anything whose *source* only updates every
   * few minutes, so polling faster fetches a number that cannot have moved.
   * Weather is the case: the forecast models refresh far more slowly than the
   * tile was asking.
   *
   * Note this bounds the *steady state* only. A tab still fetches on mount and
   * again the moment it becomes visible, so picking your phone up gets you
   * current data whatever the tier says.
   */
  slow: 900_000,
  /** Self-entered data. Refetch after you mutate it, never on a clock. */
  'event-driven': null,
};

export function intervalFor(tier: RefreshTier): number | null {
  return TIER_INTERVAL_MS[tier];
}
