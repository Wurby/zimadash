import { useCallback, useEffect, useRef, useState } from 'react'
import { intervalFor, type RefreshTier } from '@shared/tiers'

/**
 * One scheduler for the whole app rather than a timer per component.
 *
 * Twenty tiles on the same tier share a single interval and therefore tick
 * together, which matters on a wall display: staggered timers make a grid
 * shimmer as each tile updates on its own beat.
 *
 * Ticking stops entirely while the tab is hidden — the phone in your pocket
 * should not be polling at a wall-display cadence — and resumes with an
 * immediate tick so a woken tab is never showing stale numbers.
 */

type Tick = () => void

interface TierState {
  subscribers: Set<Tick>
  timer: ReturnType<typeof setInterval> | null
}

const tiers = new Map<RefreshTier, TierState>()

function stateFor(tier: RefreshTier): TierState {
  let state = tiers.get(tier)
  if (!state) {
    state = { subscribers: new Set(), timer: null }
    tiers.set(tier, state)
  }
  return state
}

function runTier(tier: RefreshTier): void {
  if (typeof document !== 'undefined' && document.hidden) return
  for (const tick of stateFor(tier).subscribers) tick()
}

function startTimer(tier: RefreshTier): void {
  const state = stateFor(tier)
  const interval = intervalFor(tier)
  if (state.timer !== null || interval === null) return
  state.timer = setInterval(() => runTier(tier), interval)
}

function stopTimer(tier: RefreshTier): void {
  const state = stateFor(tier)
  if (state.timer === null) return
  clearInterval(state.timer)
  state.timer = null
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      for (const tier of tiers.keys()) stopTimer(tier)
      return
    }
    // Catch up immediately, then resume the regular cadence.
    for (const [tier, state] of tiers) {
      if (state.subscribers.size === 0) continue
      runTier(tier)
      startTimer(tier)
    }
  })
}

/** Subscribe to a tier's tick. Returns an unsubscribe function. */
export function subscribe(tier: RefreshTier, tick: Tick): () => void {
  const state = stateFor(tier)
  state.subscribers.add(tick)
  startTimer(tier)

  return () => {
    state.subscribers.delete(tick)
    if (state.subscribers.size === 0) stopTimer(tier)
  }
}

/**
 * Run `callback` on the given tier's cadence, plus once on mount.
 *
 * `event-driven` subscribes but never ticks on a clock — it still runs once on
 * mount, and you refetch by hand after mutating.
 */
export function useRefresh(tier: RefreshTier, callback: () => void): void {
  // The callback identity changes every render; the subscription must not, or
  // every tile would unsubscribe and resubscribe on each tick.
  const latest = useRef(callback)
  useEffect(() => {
    latest.current = callback
  })

  useEffect(() => {
    const tick = () => latest.current()
    tick()
    return subscribe(tier, tick)
  }, [tier])
}

export type Polled<T> =
  | { status: 'loading' }
  | { status: 'ok'; data: T; at: number }
  | { status: 'error'; message: string }

/**
 * Fetch on a tier's cadence and keep the last good value.
 *
 * A failed refresh replaces the value with an error rather than showing a
 * number that is quietly minutes old — a wall display you read from across the
 * room has to be honest about going stale.
 */
export function usePolled<T>(
  tier: RefreshTier,
  fetcher: () => Promise<T>,
): Polled<T> & {
  refresh: () => void
} {
  const [state, setState] = useState<Polled<T>>({ status: 'loading' })

  const run = useRef(fetcher)
  useEffect(() => {
    run.current = fetcher
  })

  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const load = useCallback(() => {
    run
      .current()
      .then((data) => {
        if (alive.current) setState({ status: 'ok', data, at: Date.now() })
      })
      .catch((err: unknown) => {
        if (!alive.current) return
        setState({ status: 'error', message: err instanceof Error ? err.message : 'failed' })
      })
  }, [])

  useRefresh(tier, load)

  return { ...state, refresh: load }
}
