import { useEffect, useRef, useState } from 'react'
import { type Age, type ItemView, humanElapsed, humanLast } from '@shared/lasttime'
import { usePolled } from '../../lib/refresh'
import { defineTool } from '../types'
import meta from './meta.json'
import { getItems, tapItem, undoTap } from './api'
import { Config } from './Config'

/**
 * Last time I… — the things with no schedule.
 *
 * The tile is the tool: you tap a thing to say you just did it, and the bar
 * fills and reddens as it ages. The route behind the title band is
 * configuration only — what exists, how often it's due, and what shows here.
 *
 * `ambient` rather than `event-driven` even though the data only changes when
 * you tap it: what's on screen is elapsed *time*, which moves on its own. The
 * wall display is the case that decides it — always on, never touched, and a
 * readout that stayed at "3d" for a week would be worse than useless.
 */

/**
 * How overdue reads as colour. A tool's own data colours are exempt from the
 * slate-and-sky rule, and this is a three-step scale that has to separate at a
 * glance from across a room — accent alone can't do that.
 */
const AGE_FILL: Record<Age, string> = {
  fresh: 'bg-accent',
  due: 'bg-amber-500 dark:bg-amber-400',
  overdue: 'bg-danger',
}

const AGE_TEXT: Record<Age, string> = {
  fresh: 'text-ink-dim',
  due: 'text-amber-700 dark:text-amber-400',
  overdue: 'text-danger',
}

/** How long the undo stays offered after a tap — the same 5 seconds a quick
 *  action holds its checkmark. */
const UNDO_MS = 5_000

function fillPercent(item: ItemView): number {
  if (item.elapsedDays === null || item.intervalDays <= 0) return 100
  return Math.min(100, (item.elapsedDays / item.intervalDays) * 100)
}

function Tile() {
  const list = usePolled('ambient', getItems)
  const [busy, setBusy] = useState<string | null>(null)
  const [tapped, setTapped] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  function offerUndo(id: string) {
    setTapped(id)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setTapped(null), UNDO_MS)
  }

  async function log(item: ItemView) {
    setBusy(item.id)
    try {
      await tapItem(item.id)
      list.refresh()
      offerUndo(item.id)
    } finally {
      setBusy(null)
    }
  }

  async function revert(item: ItemView) {
    setBusy(item.id)
    if (timer.current) clearTimeout(timer.current)
    setTapped(null)
    try {
      await undoTap(item.id)
      list.refresh()
    } finally {
      setBusy(null)
    }
  }

  if (list.status === 'loading') return <p className="text-ink-dim text-sm">loading…</p>
  if (list.status === 'error') return <p className="text-danger text-sm">{list.message}</p>

  const shown = list.data.items.filter((item) => item.onTile)

  if (shown.length === 0) {
    return (
      <p className="text-ink-dim text-sm italic">
        {list.data.items.length === 0
          ? 'Nothing tracked yet — open it to add something.'
          : 'Nothing set to show here.'}
      </p>
    )
  }

  return (
    <ul className="flex h-full flex-col justify-between gap-1.5">
      {shown.map((item) => (
        <li key={item.id} className="min-h-0">
          {tapped === item.id ? (
            <button
              type="button"
              onClick={() => revert(item)}
              disabled={busy === item.id}
              className="border-accent text-accent hover:bg-accent/10 flex w-full items-baseline justify-between gap-2 border px-1.5 py-0.5 text-left transition-colors disabled:opacity-50"
            >
              <span className="truncate text-xs font-medium">Logged — undo?</span>
              <span className="shrink-0 font-mono text-[0.65rem]">↺</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => log(item)}
              disabled={busy === item.id}
              aria-label={`Log ${item.label} — ${humanLast(item.elapsedDays)}`}
              className="hover:bg-line/40 focus-visible:bg-line/40 block w-full px-1 py-0.5 text-left outline-none disabled:opacity-50"
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate text-xs font-medium">{item.label}</span>
                <span
                  className={`shrink-0 font-mono text-[0.65rem] tabular-nums ${AGE_TEXT[item.age]}`}
                >
                  {humanElapsed(item.elapsedDays)}
                </span>
              </span>
              <span className="bg-line mt-1 block h-1 w-full overflow-hidden">
                <span
                  className={`block h-full transition-[width] duration-500 ${AGE_FILL[item.age]}`}
                  style={{ width: `${fillPercent(item)}%` }}
                />
              </span>
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

export default defineTool({
  meta,
  tier: 'ambient',
  Tile,
  View: Config,
  // Logging is one tap and belongs on the grid; the route is where you set the
  // thing up. So the tile keeps its own taps and the title band is the way in.
  interactiveTile: true,
})
