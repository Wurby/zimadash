import { useState } from 'react'
import { WEEKLY_FLOOR, WEEKLY_TARGET, type PersonalRecord, type SessionType } from '@shared/trainer'
import { usePolled } from '../../lib/refresh'
import { getLift, getProgress, type LiftPoint } from './api'
import { HabitGrid, HabitLegend } from './HabitGrid'

/**
 * The point of the tool: showing up, and getting stronger.
 *
 * Deliberately not a chart per lift — the habit grid and the PR board carry it,
 * and a single lift's history is a drill-down for when you want it rather than
 * the thing you land on.
 */

/** Minimum comfortable touch target. */
const TOUCH = 'min-h-11'

function WeekMeter({ count }: { count: number }) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-ink-dim text-xs tracking-wide uppercase">This week</span>
        <span className="font-mono text-sm tabular-nums">
          {count}
          <span className="text-ink-dim">/{WEEKLY_TARGET}</span>
        </span>
      </div>
      <div className="mt-1.5 flex gap-1">
        {Array.from({ length: WEEKLY_TARGET }, (_, index) => (
          <span
            key={index}
            className={`h-1.5 flex-1 ${index < count ? 'bg-accent' : 'bg-line'}`}
            aria-hidden="true"
          />
        ))}
      </div>
    </div>
  )
}

function VolumeChart({ points }: { points: { date: string; volume: number }[] }) {
  if (points.length === 0) return null
  const peak = Math.max(...points.map((point) => point.volume), 1)

  return (
    <div>
      <p className="text-ink-dim text-xs tracking-wide uppercase">Load moved per session</p>
      <div className="mt-2 flex h-16 items-end gap-1">
        {points.map((point) => (
          <span
            key={point.date}
            title={`${point.date} — ${Math.round(point.volume).toLocaleString()} lb`}
            className="bg-accent min-h-px flex-1"
            style={{ height: `${(point.volume / peak) * 100}%` }}
          />
        ))}
      </div>
      <p className="text-ink-dim mt-1 font-mono text-[0.65rem]">
        peak {Math.round(peak).toLocaleString()} lb
      </p>
    </div>
  )
}

function LiftDetail({ exercise, onClose }: { exercise: string; onClose: () => void }) {
  const lift = usePolled('event-driven', () => getLift(exercise))
  const points: LiftPoint[] = lift.status === 'ok' ? lift.data.points : []
  const peak = Math.max(...points.map((point) => point.weightLb), 1)

  return (
    <div className="border-line bg-surface border p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{exercise}</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className={`border-line text-ink-dim hover:border-accent ${TOUCH} w-11 shrink-0 border text-xs`}
        >
          ✕
        </button>
      </div>

      {lift.status === 'loading' && <p className="text-ink-dim mt-2 text-xs">loading…</p>}

      {points.length > 0 && (
        <>
          {/* A step chart, because the loads are a discrete ladder — progress
              here is rungs climbed, and a smooth line would imply weights that
              this equipment cannot build. */}
          <div className="mt-3 flex h-20 items-end gap-1">
            {points.map((point) => (
              <span
                key={`${point.date}-${point.weightLb}`}
                title={`${point.date} — ${point.weightLb}lb ${point.sets}x${point.reps}`}
                className="bg-accent min-h-px flex-1"
                style={{ height: `${(point.weightLb / peak) * 100}%` }}
              />
            ))}
          </div>
          <ul className="text-ink-dim mt-2 space-y-0.5 font-mono text-[0.65rem]">
            {[...points].reverse().map((point) => (
              <li key={`${point.date}-${point.weightLb}-${point.reps}`}>
                {point.date} · {point.weightLb}lb · {point.sets}x{point.reps} · {point.rating}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function RecordRow({ record, onOpen }: { record: PersonalRecord; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={`border-line bg-surface hover:border-accent ${TOUCH} flex w-full items-center gap-3 border px-3 py-2 text-left transition-colors`}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{record.exercise}</span>
          <span className="text-ink-dim block font-mono text-[0.65rem]">
            {record.date} · e1RM {record.oneRepMax}
            {record.previousOneRepMax === null ? ' · first' : ` · beat ${record.previousOneRepMax}`}
          </span>
        </span>
        <span className="shrink-0 text-right font-mono text-sm tabular-nums">
          {record.weightLb}
          <span className="text-ink-dim text-xs">lb</span>
          <span className="text-ink-dim block text-[0.65rem]">×{record.reps}</span>
        </span>
      </button>
    </li>
  )
}

export function ProgressTab() {
  const progress = usePolled('event-driven', getProgress)
  const [open, setOpen] = useState<string | null>(null)

  if (progress.status === 'loading') return <p className="text-ink-dim text-sm">loading…</p>
  if (progress.status === 'error') return <p className="text-danger text-sm">{progress.message}</p>

  const { grid, weeks, streak, records, perSession } = progress.data
  const thisWeek = weeks[weeks.length - 1]?.count ?? 0

  if (perSession.length === 0) {
    return (
      <p className="text-ink-dim text-sm italic">
        Nothing logged yet. Import your log from Settings and this fills in.
      </p>
    )
  }

  const byType = new Map<SessionType, number>()
  for (const session of perSession) {
    byType.set(session.type, (byType.get(session.type) ?? 0) + 1)
  }

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 gap-4">
        <WeekMeter count={thisWeek} />
        <div>
          <span className="text-ink-dim text-xs tracking-wide uppercase">Streak</span>
          <p className="font-mono text-2xl leading-tight tabular-nums">
            {streak}
            <span className="text-ink-dim ml-1 text-xs">{streak === 1 ? 'week' : 'weeks'}</span>
          </p>
          <p className="text-ink-dim text-[0.65rem]">{WEEKLY_FLOOR}+ a week keeps it</p>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold tracking-tight">Showing up</h2>
        <div className="mt-3">
          <HabitGrid cells={grid} cell={11} />
        </div>
        <div className="mt-3">
          <HabitLegend />
        </div>
        <p className="text-ink-dim mt-2 text-xs">
          {perSession.length} sessions ·{' '}
          {[...byType.entries()].map(([type, count]) => `${count} ${type}`).join(' · ')}
        </p>
      </section>

      <section>
        <VolumeChart points={perSession} />
      </section>

      <section>
        <h2 className="text-sm font-semibold tracking-tight">
          Personal records
          <span className="text-ink-dim ml-2 font-mono text-xs">{records.length}</span>
        </h2>

        {open && (
          <div className="mt-3">
            <LiftDetail exercise={open} onClose={() => setOpen(null)} />
          </div>
        )}

        <ul className="mt-3 space-y-1">
          {records.map((record) => (
            <RecordRow
              key={`${record.exercise}-${record.date}-${record.oneRepMax}`}
              record={record}
              onOpen={() => setOpen(record.exercise)}
            />
          ))}
        </ul>
      </section>
    </div>
  )
}
