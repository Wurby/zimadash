import { useEffect, useState } from 'react'
import type { Entry, LogGrain, PendingEstimate, Settings } from '@shared/calories'
import {
  MONTH_LABELS,
  dayKeyFromMs,
  endOfMonth,
  shiftDayKey,
  startOfMonth,
  startOfWeek,
  weekdaySunday,
} from '@shared/calories'
import { Icon } from '../../components/Icon'
import { usePolled } from '../../lib/refresh'
import {
  deleteEntry,
  getLogView,
  logDirect,
  patchEntry,
  reestimateEntry,
  searchLog,
  tracked,
  type LogView,
  type RecentMeal,
} from './api'
import { derivedCalories } from './macros'

/**
 * The meal history. Lands on today; breadcrumbs zoom to week, month, year.
 * Search looks through all history. Re-logging a past meal adds it to today.
 */

const GRAINS: { id: LogGrain; label: string }[] = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'year', label: 'Year' },
]

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

function parseDay(dayKey: string): Date {
  const [y, m, d] = dayKey.split('-').map(Number)
  return new Date(y, m - 1, d, 12)
}

function headingFor(view: LogView): string {
  if (view.grain === 'day') {
    if (view.date === view.today) return 'Today'
    return parseDay(view.date).toLocaleDateString([], {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    })
  }
  if (view.grain === 'week') {
    const from = parseDay(view.from)
    const to = parseDay(view.to)
    const sameMonth = from.getMonth() === to.getMonth()
    const left = from.toLocaleDateString([], { month: 'short', day: 'numeric' })
    const right = to.toLocaleDateString([], {
      month: sameMonth ? undefined : 'short',
      day: 'numeric',
    })
    return `${left} – ${right}`
  }
  if (view.grain === 'month') {
    return parseDay(view.from).toLocaleDateString([], { month: 'long', year: 'numeric' })
  }
  return view.from.slice(0, 4)
}

function AgainPill({
  meal,
  onAdd,
  busy,
}: {
  meal: RecentMeal
  onAdd: (meal: RecentMeal) => Promise<void>
  busy: boolean
}) {
  const [confirming, setConfirming] = useState(false)

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        if (confirming) {
          setConfirming(false)
          void onAdd(meal)
          return
        }
        setConfirming(true)
      }}
      onBlur={() => setConfirming(false)}
      className={`border bg-surface flex min-h-11 items-center gap-2 px-3 text-sm disabled:opacity-50 ${
        confirming ? 'border-accent text-accent' : 'border-line hover:border-accent'
      }`}
    >
      {confirming ? 'Tap again to add' : meal.description}
      {!confirming && (
        <span className="text-ink-dim font-mono text-xs tabular-nums">
          {Math.round(meal.values.calories ?? 0)}
        </span>
      )}
    </button>
  )
}

function Row({
  entry,
  fields,
  onChanged,
}: {
  entry: Entry
  fields: ReturnType<typeof tracked>
  onChanged: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [confirming, setConfirming] = useState(false)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [proposal, setProposal] = useState<PendingEstimate | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)

  function startEdit() {
    setDraft(
      Object.fromEntries(
        fields.map((field) => [
          field.id,
          entry.values[field.id] === undefined ? '' : String(entry.values[field.id]),
        ]),
      ),
    )
    setEditing(true)
  }

  const when = new Date(entry.at).toLocaleString([], {
    hour: '2-digit',
    minute: '2-digit',
  })

  const asNumbers = Object.fromEntries(
    Object.entries(draft).map(([id, raw]) => [id, Number(raw) || 0]),
  )
  const fromMacros = Math.round(derivedCalories(asNumbers))
  const suggestion =
    fromMacros > 0 && Math.abs(fromMacros - (Number(draft.calories) || 0)) > 15 ? fromMacros : null

  async function save() {
    const values = Object.fromEntries(
      Object.entries(draft)
        .filter(([, raw]) => raw.trim() !== '' && Number.isFinite(Number(raw)))
        .map(([id, raw]) => [id, Number(raw)]),
    )

    setBusy(true)
    try {
      await patchEntry(entry.id, values)
      setEditing(false)
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    try {
      await deleteEntry(entry.id)
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  async function addToday() {
    setBusy(true)
    try {
      await logDirect(entry.description, entry.values)
      setAdding(false)
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  async function ask() {
    const said = prompt.trim()
    if (!said || busy) return
    setAiError(null)
    setBusy(true)
    try {
      setProposal(await reestimateEntry(entry.id, said))
      setPrompt('')
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'could not rethink that')
    } finally {
      setBusy(false)
    }
  }

  async function applyProposal() {
    if (!proposal) return
    setBusy(true)
    try {
      await patchEntry(entry.id, proposal.values)
      setProposal(null)
      setAsking(false)
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="px-1 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate text-sm font-medium">
          {entry.description || <span className="text-ink-dim italic">quick entry</span>}
        </p>
        <span className="text-ink-dim shrink-0 font-mono text-xs tabular-nums">{when}</span>
      </div>

      {entry.assumptions && !editing && (
        <p className="text-ink-dim mt-1 text-xs italic">{entry.assumptions}</p>
      )}

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
        {fields.map((field) =>
          editing ? (
            <label key={field.id} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="size-2 shrink-0"
                style={{ background: field.color }}
              />
              <span className="text-ink-dim text-[0.65rem] tracking-wide uppercase">
                {field.label}
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={draft[field.id] ?? ''}
                onChange={(e) => setDraft({ ...draft, [field.id]: e.target.value })}
                className="border-line focus:border-accent w-18 border bg-transparent px-1.5 py-1 font-mono text-xs outline-none"
              />
            </label>
          ) : entry.values[field.id] === undefined ? null : (
            <span key={field.id} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="size-2 shrink-0"
                style={{ background: field.color }}
              />
              <span className="text-ink-dim text-[0.65rem] tracking-wide uppercase">
                {field.label}
              </span>
              <span className="font-mono text-xs tabular-nums">
                {Math.round(entry.values[field.id])}
                {field.unit === 'kcal' ? '' : field.unit}
              </span>
            </span>
          ),
        )}
      </div>

      {asking && (
        <div className="border-accent mt-3 border p-3">
          {proposal ? (
            <>
              <p className="text-ink-dim text-xs italic">{proposal.assumptions}</p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {fields.map((field) => {
                  const next = proposal.values[field.id]
                  if (next === undefined) return null
                  const before = entry.values[field.id]
                  return (
                    <span key={field.id} className="flex items-center gap-1.5">
                      <span
                        aria-hidden="true"
                        className="size-2 shrink-0"
                        style={{ background: field.color }}
                      />
                      <span className="text-ink-dim text-[0.65rem] tracking-wide uppercase">
                        {field.label}
                      </span>
                      {before !== undefined && Math.round(before) !== Math.round(next) && (
                        <span className="text-ink-dim font-mono text-xs line-through tabular-nums">
                          {Math.round(before)}
                        </span>
                      )}
                      <span className="font-mono text-xs tabular-nums">{Math.round(next)}</span>
                    </span>
                  )
                })}
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={applyProposal}
                  disabled={busy}
                  className="bg-accent min-h-11 grow px-3 text-xs font-medium text-slate-50 disabled:opacity-50 dark:text-slate-900"
                >
                  {busy ? 'working…' : 'Apply'}
                </button>
                <button
                  type="button"
                  onClick={() => setProposal(null)}
                  className="border-line hover:border-accent min-h-11 border px-3 text-xs"
                >
                  Ask again
                </button>
              </div>
            </>
          ) : (
            <input
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && void ask()}
              disabled={busy}
              autoFocus
              placeholder="What was wrong with it?"
              className="border-line focus:border-accent w-full border bg-transparent px-3 py-2 text-sm outline-none disabled:opacity-50"
            />
          )}

          {busy && !proposal && (
            <p className="text-ink-dim mt-2 animate-pulse font-mono text-xs">rethinking…</p>
          )}
          {aiError && <p className="text-danger mt-2 text-xs">{aiError}</p>}
        </div>
      )}

      {editing && suggestion !== null && (
        <p className="text-ink-dim mt-2 flex items-center gap-2 font-mono text-xs">
          macros come to {suggestion} kcal
          <button
            type="button"
            onClick={() => setDraft({ ...draft, calories: String(suggestion) })}
            className="border-line hover:border-accent text-ink border px-2 py-0.5"
          >
            use it
          </button>
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
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
          <>
            <button
              type="button"
              onClick={startEdit}
              className="border-line hover:border-accent min-h-11 border px-3 text-xs"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => {
                setAsking((was) => !was)
                setProposal(null)
                setAiError(null)
              }}
              aria-label="Correct this with a description"
              className={`flex min-h-11 items-center gap-1.5 border px-3 text-xs ${
                asking ? 'border-accent text-accent' : 'border-line hover:border-accent'
              }`}
            >
              <Icon name="sparkle" />
              Edit with AI
            </button>
            <button
              type="button"
              onClick={() => (adding ? void addToday() : setAdding(true))}
              onBlur={() => setAdding(false)}
              disabled={busy || !entry.description.trim()}
              className={`min-h-11 border px-3 text-xs disabled:opacity-50 ${
                adding ? 'border-accent text-accent' : 'border-line hover:border-accent'
              }`}
            >
              {adding ? 'Tap again to add' : 'Again'}
            </button>
          </>
        )}

        <button
          type="button"
          onClick={() => (confirming ? remove() : setConfirming(true))}
          onBlur={() => setConfirming(false)}
          disabled={busy}
          className={`ml-auto min-h-11 border px-3 text-xs disabled:opacity-50 ${
            confirming ? 'border-danger text-danger' : 'border-line hover:border-danger'
          }`}
        >
          {confirming ? 'Tap again to delete' : 'Delete'}
        </button>

        {entry.edited && <span className="text-ink-dim font-mono text-[0.65rem]">edited</span>}
      </div>
    </li>
  )
}

function Calendar({
  view,
  onPickDay,
  onPickMonth,
}: {
  view: LogView
  onPickDay: (date: string) => void
  onPickMonth: (month: string) => void
}) {
  const logged = new Set(view.loggedDays)
  const loggedMonths = new Set(view.loggedMonths)

  if (view.grain === 'year') {
    const year = view.from.slice(0, 4)
    return (
      <div className="grid grid-cols-3 gap-2">
        {MONTH_LABELS.map((label, index) => {
          const month = `${year}-${String(index + 1).padStart(2, '0')}`
          const current = view.date.startsWith(month)
          return (
            <button
              key={month}
              type="button"
              onClick={() => onPickMonth(month)}
              className={`min-h-11 border text-sm ${
                current
                  ? 'border-accent bg-accent text-slate-50 dark:text-slate-900'
                  : loggedMonths.has(month)
                    ? 'border-line hover:border-accent text-ink'
                    : 'border-line text-ink-dim hover:border-accent'
              }`}
            >
              {label}
            </button>
          )
        })}
      </div>
    )
  }

  const from = view.grain === 'week' ? startOfWeek(view.date) : startOfMonth(view.date)
  const to = view.grain === 'week' ? view.to : endOfMonth(view.date)
  const lead = view.grain === 'week' ? 0 : weekdaySunday(from)
  const days: (string | null)[] = Array.from({ length: lead }, () => null)
  for (let day = from; day <= to; day = shiftDayKey(day, 1)) days.push(day)

  return (
    <div>
      <div className="mb-1 grid grid-cols-7">
        {WEEKDAYS.map((label, i) => (
          <div key={`${label}-${i}`} className="text-ink-dim py-1 text-center text-[0.65rem]">
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((day, i) =>
          day === null ? (
            <div key={`empty-${i}`} />
          ) : (
            <button
              key={day}
              type="button"
              onClick={() => onPickDay(day)}
              className={`min-h-11 border font-mono text-sm tabular-nums ${
                day === view.date
                  ? 'border-accent bg-accent text-slate-50 dark:text-slate-900'
                  : day === view.today
                    ? 'border-accent text-accent'
                    : logged.has(day)
                      ? 'border-line hover:border-accent text-ink'
                      : 'border-line text-ink-dim hover:border-accent'
              }`}
            >
              {Number(day.slice(8))}
            </button>
          ),
        )}
      </div>
    </div>
  )
}

function Summary({ view }: { view: LogView }) {
  if (view.grain === 'day') {
    return (
      <p className="font-mono text-sm tabular-nums">
        {Math.round(view.totals.calories ?? 0)}
        <span className="text-ink-dim ml-2 text-xs">kcal</span>
      </p>
    )
  }

  return (
    <dl className="text-ink-dim grid grid-cols-3 gap-2 font-mono text-xs tabular-nums">
      <div>
        <dt className="tracking-wide uppercase">Meals</dt>
        <dd className="text-ink mt-0.5 text-sm">{view.summary.meals}</dd>
      </div>
      <div>
        <dt className="tracking-wide uppercase">Days</dt>
        <dd className="text-ink mt-0.5 text-sm">{view.summary.daysLogged}</dd>
      </div>
      <div>
        <dt className="tracking-wide uppercase">Avg / day</dt>
        <dd className="text-ink mt-0.5 text-sm">{Math.round(view.summary.averageDailyCalories)}</dd>
      </div>
    </dl>
  )
}

function LogPane({
  grain,
  date,
  fields,
  onGrain,
  onDate,
}: {
  grain: LogGrain
  date: string
  fields: ReturnType<typeof tracked>
  onGrain: (grain: LogGrain) => void
  onDate: (date: string) => void
}) {
  const view = usePolled('event-driven', () => getLogView(grain, date))
  const [busy, setBusy] = useState(false)

  async function add(meal: RecentMeal) {
    setBusy(true)
    try {
      await logDirect(meal.description, meal.values)
      view.refresh()
    } finally {
      setBusy(false)
    }
  }

  if (view.status === 'loading') return <p className="text-ink-dim text-sm">loading…</p>
  if (view.status === 'error') return <p className="text-danger text-sm">{view.message}</p>

  const data = view.data

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {GRAINS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onGrain(item.id)}
            aria-pressed={grain === item.id}
            className={`min-h-11 border px-3 text-sm ${
              grain === item.id
                ? 'border-accent text-accent'
                : 'border-line hover:border-accent bg-surface'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">{headingFor(data)}</h2>
        <Summary view={data} />
      </div>

      {grain !== 'day' && (
        <Calendar
          view={data}
          onPickDay={(day) => {
            onDate(day)
            onGrain('day')
          }}
          onPickMonth={(month) => {
            onDate(data.date.startsWith(month) ? data.date : `${month}-01`)
            onGrain('month')
          }}
        />
      )}

      {grain === 'week' && data.pills.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {data.pills.map((meal) => (
            <AgainPill key={meal.description} meal={meal} onAdd={add} busy={busy} />
          ))}
        </div>
      )}

      {grain === 'day' && data.entries.length === 0 && (
        <p className="text-ink-dim text-sm">Nothing logged this day.</p>
      )}

      {grain === 'day' && data.entries.length > 0 && (
        <ul className="divide-line divide-y">
          {data.entries.map((entry) => (
            <Row key={entry.id} entry={entry} fields={fields} onChanged={view.refresh} />
          ))}
        </ul>
      )}
    </div>
  )
}

function SearchPane({ query, onPick }: { query: string; onPick: (date: string) => void }) {
  const results = usePolled('event-driven', () => searchLog(query).then((r) => r.hits))

  if (results.status === 'loading') return <p className="text-ink-dim text-sm">searching…</p>
  if (results.status === 'error') return <p className="text-danger text-sm">{results.message}</p>
  if (results.data.length === 0) {
    return <p className="text-ink-dim text-sm">Nothing matches.</p>
  }

  return (
    <ul className="divide-line divide-y">
      {results.data.map((hit) => (
        <li key={hit.entry.id}>
          <button
            type="button"
            onClick={() => onPick(hit.date)}
            className="hover:border-accent min-h-11 flex w-full items-baseline justify-between gap-3 py-3 text-left"
          >
            <span className="min-w-0 truncate text-sm font-medium">
              {hit.entry.description || <span className="text-ink-dim italic">quick entry</span>}
            </span>
            <span className="text-ink-dim shrink-0 font-mono text-xs tabular-nums">
              {parseDay(hit.date).toLocaleDateString([], { month: 'short', day: 'numeric' })}
              {hit.entry.values.calories !== undefined
                ? ` · ${Math.round(hit.entry.values.calories)}`
                : ''}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

export function LogTab({ settings }: { settings: Settings | null }) {
  const [grain, setGrain] = useState<LogGrain>('day')
  const [date, setDate] = useState(() => dayKeyFromMs(Date.now()))
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const fields = tracked(settings)
  const searching = query.trim().length > 0

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 200)
    return () => clearTimeout(timer)
  }, [query])

  return (
    <div className="space-y-4">
      <div className="relative">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search meals…"
          className="border-line bg-surface focus:border-accent w-full border py-3.5 pr-24 pl-4 text-base outline-none"
        />
        {searching && (
          <div className="absolute inset-y-0 right-0 flex">
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="text-ink-dim hover:text-accent grid w-12 place-items-center"
            >
              ×
            </button>
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Close search"
              className="text-ink-dim hover:text-accent grid w-12 place-items-center"
            >
              <Icon name="back" />
            </button>
          </div>
        )}
      </div>

      {searching ? (
        debounced ? (
          <SearchPane
            key={debounced}
            query={debounced}
            onPick={(picked) => {
              setDate(picked)
              setGrain('day')
              setQuery('')
            }}
          />
        ) : (
          <p className="text-ink-dim text-sm">searching…</p>
        )
      ) : (
        <LogPane
          key={`${grain}:${date}`}
          grain={grain}
          date={date}
          fields={fields}
          onGrain={setGrain}
          onDate={setDate}
        />
      )}
    </div>
  )
}
