import { useCallback, useRef, useState } from 'react'
import { applyOrder, type Layout } from '@shared/layout'
import { api } from './api'
import { usePolled } from './refresh'

/**
 * The arrangement of the dashboard.
 *
 * One order, shared by every device — sizes already differ per surface, so the
 * same sequence packs differently on a phone and on the wall without needing
 * two layouts. Per-device arrangements are a later phase.
 *
 * Reordering saves on each drop rather than on leaving edit mode: a write is
 * cheap, and it means closing the tab mid-shuffle doesn't lose the shuffle.
 */
export function useLayout(present: string[]): {
  order: string[]
  reorder: (next: string[]) => void
} {
  const stored = usePolled('event-driven', () => api<Layout>('/api/layout'))
  const [local, setLocal] = useState<string[] | null>(null)

  // The stored order is the source of truth until you move something; after
  // that the local one leads, so a drag doesn't fight a refetch.
  const base = local ?? (stored.status === 'ok' ? stored.data.order : [])
  const order = applyOrder(base, present)

  const saving = useRef<Promise<unknown>>(Promise.resolve())

  const reorder = useCallback((next: string[]) => {
    setLocal(next)
    // Chained rather than fired in parallel, so two quick drops can't land out
    // of sequence and leave the server holding the earlier arrangement.
    saving.current = saving.current
      .catch(() => undefined)
      .then(() => api('/api/layout', { method: 'PUT', body: JSON.stringify({ order: next }) }))
  }, [])

  return { order, reorder }
}
