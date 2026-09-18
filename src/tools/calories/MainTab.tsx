import { useRef, useState } from 'react'
import {
  dayKeyFromMs,
  type Entry,
  type FieldConfig,
  type QueuedMeal,
  type Settings,
} from '@shared/calories'
import { Icon } from '../../components/Icon'
import { usePolled } from '../../lib/refresh'
import { shrink } from './photo'
import {
  adjustQueued,
  deleteEntry,
  dropQueued,
  fillQueued,
  getLogView,
  getRange,
  getRecent,
  getReview,
  getWeight,
  queueDirect,
  queuePhoto,
  queueText,
  tracked,
  withEffectiveGoal,
} from './api'
import { CaloriesBar } from './CaloriesBar'
import { WeightBar } from './WeightBar'
import { Chart } from './Chart'
import { buildPoints, rollingMean } from './points'
import { WeekProgress } from './WeekProgress'

/**
 * Capture is fire-and-forget. The brain runs on the server; numbers land in
 * the log when they are ready. One sentence in the adjust box rewrites
 * whichever meal it refers to.
 */

const isBareNumber = (text: string): boolean => /^\d+(\.\d+)?$/.test(text.trim())

function Totals({ totals, fields }: { totals: Record<string, number>; fields: FieldConfig[] }) {
  return (
    <div className="border-line divide-line bg-surface divide-y border">
      {fields.map((field) => {
        const value = Math.round(totals[field.id] ?? 0)
        const pct = field.goal ? Math.min(100, (value / field.goal) * 100) : null

        return (
          <div key={field.id} className="flex items-center gap-2 px-3 py-1.5">
            <span
              aria-hidden="true"
              className="size-2 shrink-0"
              style={{ background: field.color }}
            />
            <span className="text-ink-dim text-[0.65rem] font-medium tracking-wide uppercase">
              {field.label}
            </span>

            {pct !== null && (
              <span className="bg-line mx-1 hidden h-1 min-w-8 flex-1 overflow-hidden sm:block">
                <span
                  className="block h-full"
                  style={{ width: `${pct}%`, background: field.color }}
                />
              </span>
            )}

            <span className="ml-auto font-mono text-sm tabular-nums">
              {value}
              <span className="text-ink-dim text-[0.65rem]">
                {field.unit === 'kcal' ? '' : field.unit}
                {field.goal ? ` / ${field.goal}` : ''}
              </span>
            </span>
          </div>
        )
      })}
    </div>
  )
}

function QueueRow({
  item,
  fields,
  busy,
  onChanged,
}: {
  item: QueuedMeal
  fields: FieldConfig[]
  busy: boolean
  onChanged: () => void
}) {
  const [dropping, setDropping] = useState(false)
  const [fillText, setFillText] = useState('')
  const photoInput = useRef<HTMLInputElement>(null)

  const kcal = Math.round(item.values.calories ?? 0)

  async function drop() {
    await dropQueued(item.id)
    onChanged()
  }

  async function fill(body: { description?: string; image?: string }) {
    await fillQueued(item.id, body)
    setFillText('')
    onChanged()
  }

  return (
    <li className="px-1 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate text-sm font-medium">
          {item.status === 'working'
            ? item.source === 'photo'
              ? 'Photograph'
              : item.description || 'estimating…'
            : item.description || <span className="text-ink-dim italic">quick entry</span>}
        </p>
        <span className="text-ink-dim shrink-0 font-mono text-xs tabular-nums">
          {item.status === 'working'
            ? 'working…'
            : item.status === 'empty'
              ? 'needs input'
              : `+${kcal}`}
        </span>
      </div>

      {item.status === 'ready' && item.assumptions && (
        <p className="text-ink-dim mt-1 text-xs italic">{item.assumptions}</p>
      )}

      {item.status === 'ready' && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {fields.map((field) =>
            item.values[field.id] === undefined ? null : (
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
                  {Math.round(item.values[field.id])}
                </span>
              </span>
            ),
          )}
        </div>
      )}

      {item.status === 'empty' && (
        <div className="mt-2 space-y-2">
          {item.reason && <p className="text-danger text-xs">{item.reason}</p>}
          <div className="flex gap-2">
            <input
              value={fillText}
              onChange={(event) => setFillText(event.target.value)}
              onKeyDown={(event) =>
                event.key === 'Enter' &&
                fillText.trim() &&
                void fill({ description: fillText.trim() })
              }
              placeholder="Describe it, or add a photo"
              className="border-line focus:border-accent min-w-0 flex-1 border bg-transparent px-3 py-2 text-sm outline-none"
            />
            <input
              ref={photoInput}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (!file) return
                void shrink(file).then((image) => fill({ image }))
              }}
            />
            <button
              type="button"
              onClick={() => photoInput.current?.click()}
              aria-label="Photograph instead"
              className="border-line hover:border-accent grid min-h-11 min-w-11 place-items-center border"
            >
              <Icon name="camera" />
            </button>
          </div>
        </div>
      )}

      {item.status !== 'working' && (
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            disabled={busy}
            onClick={() => (dropping ? void drop() : setDropping(true))}
            onBlur={() => setDropping(false)}
            className={`min-h-11 border px-3 text-xs disabled:opacity-50 ${
              dropping ? 'border-danger text-danger' : 'border-line hover:border-danger'
            }`}
          >
            {dropping ? 'Tap again to drop' : 'Drop'}
          </button>
        </div>
      )}
    </li>
  )
}

function EntryRow({
  entry,
  fields,
  busy,
  onChanged,
}: {
  entry: Entry
  fields: FieldConfig[]
  busy: boolean
  onChanged: () => void
}) {
  const [dropping, setDropping] = useState(false)
  const kcal = Math.round(entry.values.calories ?? 0)

  async function drop() {
    await deleteEntry(entry.id)
    onChanged()
  }

  return (
    <li className="px-1 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate text-sm font-medium">
          {entry.description || <span className="text-ink-dim italic">quick entry</span>}
        </p>
        <span className="text-ink-dim shrink-0 font-mono text-xs tabular-nums">+{kcal}</span>
      </div>

      {entry.assumptions && <p className="text-ink-dim mt-1 text-xs italic">{entry.assumptions}</p>}

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {fields.map((field) =>
          entry.values[field.id] === undefined ? null : (
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
              </span>
            </span>
          ),
        )}
      </div>

      <div className="mt-2 flex justify-end">
        <button
          type="button"
          disabled={busy}
          onClick={() => (dropping ? void drop() : setDropping(true))}
          onBlur={() => setDropping(false)}
          className={`min-h-11 border px-3 text-xs disabled:opacity-50 ${
            dropping ? 'border-danger text-danger' : 'border-line hover:border-danger'
          }`}
        >
          {dropping ? 'Tap again to drop' : 'Drop'}
        </button>
      </div>
    </li>
  )
}

export function MainTab({ settings }: { settings: Settings | null }) {
  const weight = usePolled('event-driven', getWeight)
  const fields = withEffectiveGoal(
    tracked(settings),
    settings,
    weight.status === 'ok' ? weight.data.expenditure : null,
  )
  const review = usePolled('ambient', getReview)
  const recent = usePolled('event-driven', () => getRecent().then((r) => r.meals))
  const promoted = usePolled('event-driven', () => getRange('fortnight'))
  const [todayKey] = useState(() => dayKeyFromMs(Date.now()))
  const week = usePolled('event-driven', () => getLogView('week', todayKey))

  const [text, setText] = useState('')
  const [adjust, setAdjust] = useState('')
  const [capturing, setCapturing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const photoInput = useRef<HTMLInputElement>(null)

  function refreshAll() {
    review.refresh()
    recent.refresh()
    promoted.refresh()
    week.refresh()
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const value = text.trim()
    if (!value || capturing) return
    setError(null)
    setCapturing(true)
    try {
      if (isBareNumber(value)) {
        await queueDirect('', { calories: Number(value) })
      } else {
        await queueText(value)
      }
      setText('')
      refreshAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'that did not work')
    } finally {
      setCapturing(false)
      input.current?.focus()
    }
  }

  async function fromPhoto(file: File) {
    if (capturing) return
    setError(null)
    setCapturing(true)
    try {
      await queuePhoto(await shrink(file))
      refreshAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'could not queue that photo')
    } finally {
      setCapturing(false)
    }
  }

  async function relog(description: string, values: Record<string, number>) {
    setCapturing(true)
    try {
      await queueDirect(description, values)
      refreshAll()
    } finally {
      setCapturing(false)
    }
  }

  async function sendAdjust() {
    if (!review.status || review.status !== 'ok') return
    const said = adjust.trim()
    if (!said) return
    setError(null)
    try {
      await adjustQueued(review.data.day, said)
      setAdjust('')
      refreshAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'could not adjust')
    }
  }

  const rest = fields.filter((field) => field.id !== 'calories')
  const data = review.status === 'ok' ? review.data : null
  const items = data?.items ?? []
  const entries = data?.entries ?? []

  return (
    <div className="space-y-5">
      <CaloriesBar totals={data?.totals ?? {}} fields={fields} />

      {week.status === 'ok' && fields.length > 0 && (
        <WeekProgress
          totals={week.data.totals}
          fields={fields}
          today={todayKey}
          tdee={weight.status === 'ok' ? weight.data.expenditure.tdee : null}
          rateLbPerWeek={settings?.weight.rateLbPerWeek ?? 1}
          daysLogged={week.data.summary.daysLogged}
          atGoal={weight.status === 'ok' ? weight.data.expenditure.atGoal : false}
          compact
        />
      )}

      {settings?.weight.onMain && weight.status === 'ok' && (
        <WeightBar
          settings={settings.weight}
          expenditure={weight.data.expenditure}
          startLb={weight.data.trend[0]?.lb ?? null}
        />
      )}

      <form onSubmit={submit}>
        <div className="relative">
          <input
            ref={input}
            value={text}
            onChange={(event) => setText(event.target.value)}
            disabled={capturing}
            autoFocus
            enterKeyHint="done"
            placeholder="A number, or what you ate…"
            className="border-line bg-surface focus:border-accent w-full border py-3.5 pr-14 pl-4 text-base outline-none disabled:opacity-50"
          />
          <input
            ref={photoInput}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void fromPhoto(file)
            }}
          />
          <button
            type="button"
            onClick={() => photoInput.current?.click()}
            disabled={capturing}
            aria-label="Photograph the meal instead"
            className="text-ink-dim hover:text-accent absolute inset-y-0 right-0 grid w-14 place-items-center disabled:opacity-50"
          >
            <Icon name="camera" className="!h-6 !w-6" />
          </button>
        </div>
        {capturing && (
          <p className="text-ink-dim mt-2 font-mono text-xs">queued — you can lock the phone</p>
        )}
      </form>

      {error && (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      )}

      {review.status === 'loading' && <p className="text-ink-dim text-sm">loading…</p>}
      {review.status === 'error' && <p className="text-danger text-sm">{review.message}</p>}

      {items.length > 0 && (
        <div>
          <p className="text-ink-dim mb-2 text-[0.65rem] font-medium tracking-wide uppercase">
            In flight
          </p>
          <ul className="divide-line divide-y">
            {items.map((item) => (
              <QueueRow
                key={item.id}
                item={item}
                fields={fields}
                busy={capturing}
                onChanged={refreshAll}
              />
            ))}
          </ul>
        </div>
      )}

      {entries.length > 0 && (
        <div>
          <p className="text-ink-dim mb-2 text-[0.65rem] font-medium tracking-wide uppercase">
            Today · {entries.length} meal{entries.length === 1 ? '' : 's'}
          </p>
          <ul className="divide-line divide-y">
            {entries.map((entry) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                fields={fields}
                busy={Boolean(data?.adjusting)}
                onChanged={refreshAll}
              />
            ))}
          </ul>

          <div className="mt-4 space-y-2">
            <input
              value={adjust}
              onChange={(event) => setAdjust(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && void sendAdjust()}
              disabled={Boolean(data?.adjusting)}
              placeholder="Adjust the day in one sentence…"
              className="border-line focus:border-accent w-full border bg-transparent px-3 py-2 text-sm outline-none disabled:opacity-50"
            />
            {data?.adjusting && (
              <p className="text-ink-dim font-mono text-xs">applying the adjustment…</p>
            )}
            {data?.adjustError && <p className="text-danger text-xs">{data.adjustError}</p>}
          </div>
        </div>
      )}

      <div>
        <p className="text-ink-dim mb-2 text-[0.65rem] font-medium tracking-wide uppercase">
          Today
          {entries.length > 0 ? ` · ${entries.length} meals` : ''}
        </p>
        <Totals totals={data?.totals ?? {}} fields={rest} />
      </div>

      {promoted.status === 'ok' &&
        fields
          .filter((field) => field.onMain)
          .map((field) => {
            const series = buildPoints(promoted.data, field.id)
            return (
              <Chart
                key={field.id}
                label={field.label}
                color={field.color}
                goal={field.goal}
                unit={field.unit}
                points={series}
                trend={series.length > 7 ? rollingMean(series) : undefined}
              />
            )
          })}

      {recent.status === 'ok' && recent.data.length > 0 && (
        <div>
          <p className="text-ink-dim text-[0.65rem] font-medium tracking-wide uppercase">Again</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {recent.data.map((meal) => (
              <button
                key={meal.description}
                type="button"
                onClick={() => relog(meal.description, meal.values)}
                disabled={capturing}
                className="border-line hover:border-accent bg-surface flex min-h-11 items-center gap-2 border px-3 text-sm disabled:opacity-50"
              >
                {meal.description}
                <span className="text-ink-dim font-mono text-xs tabular-nums">
                  {Math.round(meal.values.calories ?? 0)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
