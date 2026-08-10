import { useState } from 'react'
import { RATING_META, dayKey, type Session } from '@shared/trainer'
import { usePolled } from '../../lib/refresh'
import { getSessions } from './api'

/**
 * Every session, reachable by date.
 *
 * A real range from the start rather than a fixed window — the calorie
 * tracker's Log tab shipped with a fortnight cap and that is still an open
 * loose end. No reason to build the same thing twice.
 */

const TOUCH = 'min-h-11'

function monthsAgo(count: number): string {
  const date = new Date()
  date.setMonth(date.getMonth() - count)
  return dayKey(date)
}

function SessionCard({ session }: { session: Session }) {
  const [open, setOpen] = useState(false)
  const notes = session.importNotes ?? []

  return (
    <li className="border-line bg-surface border">
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        className={`${TOUCH} flex w-full items-center gap-3 px-3 py-2 text-left`}
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{session.type}</span>
          <span className="text-ink-dim block font-mono text-[0.65rem]">
            {session.date} · {session.exercises.length} exercises
            {session.plannedBy === 'import' ? ' · imported' : ''}
          </span>
        </span>
        <span className="text-ink-dim shrink-0 font-mono text-xs">{open ? '−' : '+'}</span>
      </button>

      {open && (
        <div className="border-line border-t px-3 py-2">
          <ul className="space-y-1">
            {session.exercises.map((exercise) => (
              <li key={exercise.name} className="flex items-baseline gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate">{exercise.name}</span>
                <span className="text-ink-dim shrink-0 font-mono tabular-nums">
                  {exercise.result
                    ? `${exercise.result.weightLb}lb ${exercise.result.sets}×${exercise.result.reps}`
                    : '—'}
                </span>
                <span className="text-ink-dim w-16 shrink-0 text-right text-[0.65rem]">
                  {exercise.result ? RATING_META[exercise.result.rating].label : ''}
                </span>
              </li>
            ))}
          </ul>

          {notes.length > 0 && (
            <details className="mt-3">
              <summary className="text-ink-dim cursor-pointer text-xs">
                {notes.length} note{notes.length === 1 ? '' : 's'} from the import
              </summary>
              <ul className="text-ink-dim mt-1 space-y-0.5 text-[0.65rem]">
                {notes.map((note, index) => (
                  <li key={index}>· {note}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </li>
  )
}

export function HistoryTab() {
  const [from, setFrom] = useState(() => monthsAgo(6))
  const [to, setTo] = useState(() => dayKey(new Date()))

  const sessions = usePolled('event-driven', () => getSessions({ from, to }))
  const list = sessions.status === 'ok' ? sessions.data.sessions : []

  return (
    <div className="space-y-4">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          sessions.refresh()
        }}
        className="flex flex-wrap items-end gap-2"
      >
        <label>
          <span className="text-ink-dim block text-xs">From</span>
          <input
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            className={`border-line focus:border-accent ${TOUCH} mt-1 border bg-transparent px-2 font-mono text-sm outline-none`}
          />
        </label>
        <label>
          <span className="text-ink-dim block text-xs">To</span>
          <input
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            className={`border-line focus:border-accent ${TOUCH} mt-1 border bg-transparent px-2 font-mono text-sm outline-none`}
          />
        </label>
        <button
          type="submit"
          className={`border-accent text-accent hover:bg-accent/10 ${TOUCH} border px-4 text-sm transition-colors`}
        >
          show
        </button>
      </form>

      {sessions.status === 'loading' && <p className="text-ink-dim text-sm">loading…</p>}
      {sessions.status === 'error' && <p className="text-danger text-sm">{sessions.message}</p>}
      {sessions.status === 'ok' && list.length === 0 && (
        <p className="text-ink-dim text-sm italic">Nothing in that range.</p>
      )}

      <ul className="space-y-2">
        {list.map((session) => (
          <SessionCard key={session.id} session={session} />
        ))}
      </ul>
    </div>
  )
}
