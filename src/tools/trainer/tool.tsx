import { useState } from 'react'
import { WEEKLY_TARGET } from '@shared/trainer'
import { usePolled } from '../../lib/refresh'
import { defineTool } from '../types'
import meta from './meta.json'
import { getOverview, getProgress } from './api'
import { HabitGrid } from './HabitGrid'
import { ProgressTab } from './ProgressTab'
import { SessionTab } from './SessionTab'
import { HistoryTab } from './HistoryTab'
import { SettingsTab } from './SettingsTab'

/**
 * Personal trainer — showing up, and getting stronger.
 *
 * Progress is the landing tab rather than one of four, because watching the
 * numbers move is the reason the tool exists; the session flow is what feeds
 * it. Session takes the landing spot once one is actually running.
 *
 * `ambient`: the data only changes when you train, but the week counter and the
 * streak turn over on their own, and the wall display has to be right in the
 * morning without being touched.
 */

const TABS = ['Progress', 'Session', 'History', 'Settings'] as const
type Tab = (typeof TABS)[number]

/** How many weeks of grid the tile shows. Enough to read the rhythm without
 *  needing to scroll something you're only glancing at. */
const TILE_WEEKS = 14

function Tile() {
  const overview = usePolled('ambient', getOverview)
  const progress = usePolled('ambient', getProgress)

  if (overview.status === 'loading') return <p className="text-ink-dim text-sm">loading…</p>
  if (overview.status === 'error') return <p className="text-danger text-sm">{overview.message}</p>

  const { next, active, thisWeek, streak, sessionCount } = overview.data

  if (sessionCount === 0 && !active) {
    return <p className="text-ink-dim text-sm italic">Nothing logged yet — tap to import.</p>
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-medium">
          {active ? `${active.type} · ${active.cursor + 1} of ${active.exercises.length}` : next}
        </span>
        <span className="shrink-0 font-mono text-sm tabular-nums">
          {thisWeek}
          <span className="text-ink-dim text-xs">/{WEEKLY_TARGET}</span>
        </span>
      </div>

      {progress.status === 'ok' && (
        <HabitGrid cells={progress.data.grid} cell={8} weeks={TILE_WEEKS} />
      )}

      <p className="text-ink-dim mt-auto font-mono text-[0.6rem]">
        {streak > 0 ? `${streak} week${streak === 1 ? '' : 's'} running` : 'streak broken'} ·{' '}
        {sessionCount} sessions
      </p>
    </div>
  )
}

function View() {
  const overview = usePolled('event-driven', getOverview)
  const running = overview.status === 'ok' && overview.data.active !== null

  // Progress is the landing tab, because watching the numbers move is the point
  // — unless a session is actually in progress, in which case that is obviously
  // what you came back for.
  const [chosen, setChosen] = useState<Tab | null>(null)
  const tab = chosen ?? (running ? 'Session' : 'Progress')
  const setTab = setChosen

  return (
    <div>
      <nav className="border-line flex gap-1 border-b" aria-label="Trainer sections">
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setTab(name)}
            aria-current={tab === name ? 'page' : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === name
                ? 'border-accent text-accent'
                : 'hover:text-ink border-transparent text-ink-dim'
            }`}
          >
            {name}
          </button>
        ))}
      </nav>

      <div className="mt-6">
        {tab === 'Progress' && <ProgressTab />}
        {tab === 'Session' && <SessionTab />}
        {tab === 'History' && <HistoryTab />}
        {tab === 'Settings' && <SettingsTab />}
      </div>
    </div>
  )
}

export default defineTool({
  meta,
  tier: 'ambient',
  Tile,
  View,
})
