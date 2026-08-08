import { useCallback, useEffect, useRef, useState } from 'react'
import { applyOrder, type Breakpoint, type Layout, type Span } from '@shared/layout'
import { api } from './api'
import { usePolled } from './refresh'

/**
 * The arrangement of the dashboard: what order things sit in, and how big each
 * one is.
 *
 * One order shared by every device — packing is dense, so the same sequence
 * fills a phone and a wall display differently without needing two lists.
 * Sizes are the opposite: they are stored per surface, because a span means
 * something different against eight columns than against sixteen.
 *
 * Both save on every change rather than on leaving edit mode: a write is cheap,
 * and it means closing the tab mid-rearrange doesn't lose the rearrange.
 */

type Draft = Pick<Layout, 'order' | 'sizes'>

export interface Arrangement {
  order: string[]
  sizes: NonNullable<Layout['sizes']>
  reorder: (next: string[]) => void
  /** Pass null to drop the override and hand the size back to the tool. */
  resize: (id: string, at: Breakpoint, span: Span | null) => void
}

export function useLayout(present: string[]): Arrangement {
  const stored = usePolled('event-driven', () => api<Layout>('/api/layout'))
  const [local, setLocal] = useState<Draft | null>(null)

  // The stored arrangement is the source of truth until you change something;
  // after that the local one leads, so a drag doesn't fight a refetch.
  const remote = stored.status === 'ok' ? stored.data : null
  const draft = local ?? { order: remote?.order ?? [], sizes: remote?.sizes ?? {} }
  const order = applyOrder(draft.order, present)
  const sizes = draft.sizes ?? {}

  const saving = useRef<Promise<unknown>>(Promise.resolve())

  // What is on screen right now, for handlers that would otherwise close over
  // the arrangement as it was when they were bound.
  const live = useRef<Draft>({ order, sizes })
  useEffect(() => {
    live.current = { order, sizes }
  })

  const save = useCallback((next: Draft) => {
    setLocal(next)
    // Updated here as well as in the effect, so two changes landing in the same
    // tick build on each other instead of the second overwriting the first.
    live.current = next
    // Chained rather than fired in parallel, so two quick changes can't land
    // out of sequence and leave the server holding the earlier one.
    saving.current = saving.current
      .catch(() => undefined)
      .then(() => api('/api/layout', { method: 'PUT', body: JSON.stringify(next) }))
  }, [])

  const reorder = useCallback((next: string[]) => save({ ...live.current, order: next }), [save])

  const resize = useCallback(
    (id: string, at: Breakpoint, span: Span | null) => {
      const next = { ...(live.current.sizes ?? {}) }
      const entry = { ...next[id] }

      if (span) entry[at] = span
      else delete entry[at]

      // Reset the last surface and the id goes with it, so a tile you put back
      // to default leaves nothing behind.
      if (Object.keys(entry).length > 0) next[id] = entry
      else delete next[id]

      save({ ...live.current, sizes: next })
    },
    [save],
  )

  return { order, sizes, reorder, resize }
}
