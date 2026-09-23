import { useState } from 'react'
import type { DigestionEntry, DigestionRangeData, Severity, Suspect } from '@shared/calories'
import { RANGE_LABELS, type RangeKey } from '@shared/calories'
import { usePolled } from '../../lib/refresh'
import {
  deleteEpisode,
  getDigestionPatterns,
  getDigestionRange,
  getRecentEpisodes,
  getSuspects,
  logEpisode,
  patchEpisode,
} from './api'
import { Chart } from './Chart'
import { eachDay, type Point } from './points'
import { fromLocalDateTime, toLocalDateTime } from './time'

/**
 * Log a bare occurrence ("had digestive issues") with a severity, then work
 * out — from what preceded it — which foods keep showing up beforehand.
 *
 * No description on the episode itself; the signal comes entirely from
 * matching it against nearby meals. See digestionAnalysis.ts on the server
 * for the matching rule.
 */

const RANGES: RangeKey[] = ['week', 'fortnight', 'month', 'quarter', 'half', 'year']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAYPARTS = ['Morning', 'Afternoon', 'Evening', 'Night']
const SEVERITIES: Severity[] = [1, 2, 3]

function buildEpisodePoints(window: DigestionRangeData): Point[] {
  const byDate = new Map(window.days.map((day) => [day.date, day.count]))
  return eachDay(window.from, window.to).map((date) => ({ date, value: byDate.get(date) ?? 0 }))
}

function LogEpisode({ onLogged }: { onLogged: () => void }) {
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)

  async function pick(severity: Severity) {
    setBusy(true)
    try {
      await logEpisode(severity)
      setPicking(false)
      onLogged()
    } finally {
      setBusy(false)
    }
  }

  if (!picking) {
    return (
      <button
        type="button"
        onClick={() => setPicking(true)}
        className="border-danger text-danger hover:bg-danger/10 min-h-11 w-full border px-4 text-sm font-medium"
      >
        Problem
      </button>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <p className="text-ink-dim shrink-0 text-xs">How bad?</p>
      {SEVERITIES.map((severity) => (
        <button
          key={severity}
          type="button"
          disabled={busy}
          onClick={() => void pick(severity)}
          className="border-line hover:border-accent min-h-11 flex-1 border text-sm disabled:opacity-50"
        >
          {severity}
        </button>
      ))}
      <button
        type="button"
        onClick={() => setPicking(false)}
        aria-label="Cancel"
        className="border-line text-ink-dim hover:border-accent min-h-11 border px-3 text-sm"
      >
        ×
      </button>
    </div>
  )
}

function EpisodeRow({ episode, onChanged }: { episode: DigestionEntry; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  const [draftSeverity, setDraftSeverity] = useState<Severity>(episode.severity)
  const [draftAt, setDraftAt] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const when = new Date(episode.at).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  function startEdit() {
    setDraftSeverity(episode.severity)
    setDraftAt(toLocalDateTime(episode.at))
    setEditing(true)
  }

  async function save() {
    setBusy(true)
    try {
      await patchEpisode(episode.id, {
        severity: draftSeverity,
        at: draftAt ? fromLocalDateTime(draftAt) : episode.at,
      })
      setEditing(false)
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    try {
      await deleteEpisode(episode.id)
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="px-1 py-3">
      <div className="flex items-center justify-between gap-3">
        {editing ? (
          <input
            type="datetime-local"
            value={draftAt}
            onChange={(e) => setDraftAt(e.target.value)}
            className="border-line focus:border-accent border bg-transparent px-1.5 py-1 font-mono text-xs outline-none"
          />
        ) : (
          <span className="font-mono text-sm tabular-nums">{when}</span>
        )}
        {!editing && (
          <span className="text-ink-dim font-mono text-xs tabular-nums">
            severity {episode.severity}
          </span>
        )}
      </div>

      {editing && (
        <div className="mt-2 flex gap-2">
          {SEVERITIES.map((severity) => (
            <button
              key={severity}
              type="button"
              onClick={() => setDraftSeverity(severity)}
              aria-pressed={draftSeverity === severity}
              className={`min-h-11 flex-1 border text-sm ${
                draftSeverity === severity
                  ? 'border-accent text-accent'
                  : 'border-line hover:border-accent'
              }`}
            >
              {severity}
            </button>
          ))}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {editing ? (
          <>
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="bg-accent min-h-11 px-3 text-xs font-medium text-slate-50 disabled:opacity-50 dark:text-slate-900"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="border-line hover:border-accent min-h-11 border px-3 text-xs"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={startEdit}
            className="border-line hover:border-accent min-h-11 border px-3 text-xs"
          >
            Edit
          </button>
        )}

        <button
          type="button"
          onClick={() => (confirming ? void remove() : setConfirming(true))}
          onBlur={() => setConfirming(false)}
          disabled={busy}
          className={`ml-auto min-h-11 border px-3 text-xs disabled:opacity-50 ${
            confirming ? 'border-danger text-danger' : 'border-line hover:border-danger'
          }`}
        >
          {confirming ? 'Tap again to delete' : 'Delete'}
        </button>
      </div>
    </li>
  )
}

function EpisodesChart({ range }: { range: RangeKey }) {
  const data = usePolled('event-driven', () => getDigestionRange(range))

  return (
    <div className="mt-3">
      {data.status === 'loading' && <p className="text-ink-dim text-sm">loading…</p>}
      {data.status === 'error' && <p className="text-danger text-sm">{data.message}</p>}
      {data.status === 'ok' && (
        <Chart
          label="Episodes per day"
          color="#f75221"
          goal={null}
          unit=""
          points={buildEpisodePoints(data.data)}
          mode="bar"
        />
      )}
    </div>
  )
}

function EpisodesOverTime() {
  const [range, setRange] = useState<RangeKey>('fortnight')

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {RANGES.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setRange(key)}
            aria-pressed={range === key}
            className={`min-h-11 border px-3 text-sm ${
              range === key
                ? 'border-accent text-accent'
                : 'border-line hover:border-accent bg-surface'
            }`}
          >
            {RANGE_LABELS[key]}
          </button>
        ))}
      </div>

      <EpisodesChart key={range} range={range} />
    </div>
  )
}

/** Bars scaled relative to the busiest bucket rather than to an absolute
 *  count — the shape is the point, not the number. Same "start a little below
 *  the lowest bar" trick as ReportsTab's WeekdayRow, so the smallest bucket
 *  still reads as present rather than invisible. */
function RelativeBars({
  counts,
  labels,
  description,
}: {
  counts: number[]
  labels: string[]
  description: string
}) {
  const max = Math.max(...counts, 1)
  const min = Math.min(...counts)
  const spread = max - min
  const base = spread > 0 ? min - spread * 0.2 : 0
  const span = max - base || 1

  return (
    <div role="img" aria-label={description}>
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${counts.length}, minmax(0, 1fr))` }}
      >
        {counts.map((count, i) => (
          <div key={labels[i] ?? i} className="flex flex-col items-center gap-1">
            <div className="flex h-16 w-full items-end">
              {count > 0 ? (
                <span
                  className="bg-accent w-full"
                  style={{ height: `${Math.max(6, ((count - base) / span) * 100)}%` }}
                />
              ) : (
                <span className="bg-line/60 h-px w-full" />
              )}
            </div>
            <span className="text-ink-dim font-mono text-[0.6rem] tracking-wide">{labels[i]}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Patterns() {
  const data = usePolled('event-driven', getDigestionPatterns)

  if (data.status === 'loading') return <p className="text-ink-dim text-sm">loading…</p>
  if (data.status === 'error') return <p className="text-danger text-sm">{data.message}</p>

  return (
    <div className="space-y-5">
      <div>
        <p className="text-ink-dim mb-2 text-[0.65rem] font-medium tracking-wide uppercase">
          By weekday
        </p>
        <RelativeBars
          counts={data.data.weekday}
          labels={WEEKDAYS}
          description="Episodes by weekday, relative to the busiest day."
        />
      </div>
      <div>
        <p className="text-ink-dim mb-2 text-[0.65rem] font-medium tracking-wide uppercase">
          By time of day
        </p>
        <RelativeBars
          counts={data.data.daypart}
          labels={DAYPARTS}
          description="Episodes by time of day, relative to the busiest daypart."
        />
      </div>
    </div>
  )
}

function SuspectList({ title, suspects }: { title: string; suspects: Suspect[] }) {
  return (
    <div>
      <p className="text-ink-dim mb-2 text-[0.65rem] font-medium tracking-wide uppercase">
        {title}
      </p>
      {suspects.length === 0 ? (
        <p className="text-ink-dim text-sm">Not enough data yet.</p>
      ) : (
        <ul className="divide-line divide-y">
          {suspects.map((suspect) => (
            <li key={suspect.food} className="flex items-baseline justify-between gap-3 py-2">
              <span className="min-w-0 truncate text-sm">{suspect.food}</span>
              <span className="text-ink-dim shrink-0 font-mono text-xs tabular-nums">
                {Math.round(suspect.rate * 100)}% · {suspect.matches}/{suspect.times}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function DigestionTab() {
  const recent = usePolled('event-driven', getRecentEpisodes)
  const suspects = usePolled('event-driven', getSuspects)

  function refresh() {
    recent.refresh()
    suspects.refresh()
  }

  return (
    <div className="space-y-6">
      <LogEpisode onLogged={refresh} />

      <section className="border-line bg-surface border px-4 py-3">
        <EpisodesOverTime />
      </section>

      <section className="border-line bg-surface border px-4 py-3">
        <Patterns />
      </section>

      <section className="border-line bg-surface space-y-5 border px-4 py-3">
        <p className="text-sm font-semibold tracking-tight">Suspected foods</p>
        {suspects.status === 'loading' && <p className="text-ink-dim text-sm">loading…</p>}
        {suspects.status === 'error' && <p className="text-danger text-sm">{suspects.message}</p>}
        {suspects.status === 'ok' && (
          <>
            <SuspectList title="Same day" suspects={suspects.data.sameDay} />
            <SuspectList title="Next day" suspects={suspects.data.nextDay} />
            <SuspectList title="Two days out" suspects={suspects.data.twoDaysOut} />
          </>
        )}
      </section>

      <div>
        <p className="text-ink-dim mb-2 text-[0.65rem] font-medium tracking-wide uppercase">Log</p>
        {recent.status === 'loading' && <p className="text-ink-dim text-sm">loading…</p>}
        {recent.status === 'error' && <p className="text-danger text-sm">{recent.message}</p>}
        {recent.status === 'ok' &&
          (recent.data.length === 0 ? (
            <p className="text-ink-dim text-sm">Nothing logged yet.</p>
          ) : (
            <ul className="divide-line divide-y">
              {recent.data.map((episode) => (
                <EpisodeRow key={episode.id} episode={episode} onChanged={refresh} />
              ))}
            </ul>
          ))}
      </div>
    </div>
  )
}
