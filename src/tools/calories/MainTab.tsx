import { useRef, useState } from 'react'
import type { FieldConfig, PendingEstimate, Settings } from '@shared/calories'
import { Icon } from '../../components/Icon'
import { usePolled } from '../../lib/refresh'
import { derivedCalories } from './macros'
import { shrink } from './photo'
import {
  commitEstimate,
  estimateFromPhoto,
  getDay,
  getRange,
  getRecent,
  getWeight,
  logDirect,
  refineEstimate,
  startEstimate,
  tracked,
  withEffectiveGoal,
} from './api'
import { CaloriesBar } from './CaloriesBar'
import { WeightBar } from './WeightBar'
import { Chart, type Point } from './Chart'
import { buildPoints } from './points'

/**
 * The tab you land on. Type, estimate, approve, done.
 *
 * A whole-string number is calories and logs immediately — that path never
 * touches the brain, so the fast case stays fast. Anything else is a
 * description and goes for an estimate, which takes several seconds, so the
 * input has to stay visibly alive rather than looking hung.
 */

const isBareNumber = (text: string): boolean => /^\d+(\.\d+)?$/.test(text.trim())

/**
 * Everything except calories, which has its own bar above. Deliberately tight —
 * these were cards with the number floating in two-thirds empty space, and a
 * row of small facts reads faster than a grid of mostly-nothing.
 */
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

function PendingCard({
  pending,
  fields,
  busy,
  onValues,
  onRefine,
  onSave,
  onDiscard,
}: {
  pending: PendingEstimate
  fields: FieldConfig[]
  busy: boolean
  onValues: (values: Record<string, number>) => void
  onRefine: (feedback: string) => void
  onSave: () => void
  onDiscard: () => void
}) {
  const [feedback, setFeedback] = useState('')
  const correcting = feedback.trim().length > 0

  // Offered when hand-editing has pulled the calorie figure away from what the
  // macros account for. Never applied on its own — alcohol and printed labels
  // are both legitimate reasons for the two to differ.
  const fromMacros = Math.round(derivedCalories(pending.values))
  const suggestion =
    fromMacros > 0 && Math.abs(fromMacros - (pending.values.calories ?? 0)) > 15 ? fromMacros : null

  return (
    <div className="border-accent bg-surface border p-4">
      <p className="text-sm font-semibold tracking-tight">{pending.description}</p>
      {pending.assumptions && (
        <p className="text-ink-dim mt-1 text-sm italic">{pending.assumptions}</p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {fields.map((field) => (
          <label key={field.id} className="block">
            <span className="text-ink-dim flex items-center gap-1 text-[0.65rem] tracking-wide uppercase">
              <span
                aria-hidden="true"
                className="size-2 shrink-0"
                style={{ background: field.color }}
              />
              {field.label}
            </span>
            {/* Uncontrolled, and remounted per refinement round via the key, so
                the box can be emptied to retype. A controlled value coerced
                through Number() puts a 0 back the moment you clear it. */}
            <input
              key={`${field.id}-${pending.rounds}`}
              type="text"
              inputMode="decimal"
              defaultValue={pending.values[field.id] ?? ''}
              onChange={(event) =>
                onValues({ ...pending.values, [field.id]: Number(event.target.value) || 0 })
              }
              className="border-line focus:border-accent mt-1 w-full border bg-transparent px-2 py-1.5 font-mono text-sm outline-none"
            />
          </label>
        ))}
      </div>

      {suggestion !== null && (
        <p className="text-ink-dim mt-3 flex items-center gap-2 font-mono text-xs">
          macros come to {suggestion} kcal
          <button
            type="button"
            onClick={() => onValues({ ...pending.values, calories: suggestion })}
            className="border-line hover:border-accent text-ink border px-2 py-0.5"
          >
            use it
          </button>
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <input
          value={feedback}
          onChange={(event) => setFeedback(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && feedback.trim()) {
              onRefine(feedback.trim())
              setFeedback('')
            }
          }}
          disabled={busy}
          placeholder="Not right? Say what to change…"
          className="border-line focus:border-accent min-w-0 flex-1 border bg-transparent px-3 py-2 text-sm outline-none disabled:opacity-50"
        />
      </div>

      <div className="mt-3 flex gap-2">
        {/* An unsent correction locks logging. Otherwise the obvious big button
            sits right under the box you just typed in, and one thumb-tap saves
            the old numbers and throws the correction away. */}
        <button
          type="button"
          onClick={onSave}
          disabled={busy || correcting}
          className="bg-accent grow px-4 py-2.5 text-sm font-medium text-slate-50 disabled:opacity-50 dark:text-slate-900"
        >
          {busy ? 'working…' : correcting ? 'Send your change first' : 'Log it'}
        </button>
        <button
          type="button"
          onClick={onDiscard}
          disabled={busy}
          className="border-line hover:border-danger px-4 py-2.5 text-sm font-medium disabled:opacity-50"
        >
          Discard
        </button>
      </div>
    </div>
  )
}

export function MainTab({ settings }: { settings: Settings | null }) {
  const weight = usePolled('event-driven', getWeight)
  // When the computed target is on, it stands in for the hand-set calorie goal
  // everywhere below without any of this knowing about weight.
  const fields = withEffectiveGoal(
    tracked(settings),
    settings,
    weight.status === 'ok' ? weight.data.expenditure : null,
  )
  const day = usePolled('event-driven', getDay)
  const recent = usePolled('event-driven', () => getRecent().then((r) => r.meals))
  const promoted = usePolled('event-driven', () => getRange('fortnight'))

  const [text, setText] = useState('')
  const [pending, setPending] = useState<PendingEstimate | null>(null)
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState<'text' | 'photo'>('text')
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const photoInput = useRef<HTMLInputElement>(null)

  function refreshAll() {
    day.refresh()
    recent.refresh()
    promoted.refresh()
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const value = text.trim()
    if (!value || busy) return

    setError(null)
    setBusy(true)
    try {
      if (isBareNumber(value)) {
        await logDirect('', { calories: Number(value) })
        setText('')
        refreshAll()
      } else {
        setPending(await startEstimate(value))
        setText('')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'that did not work')
    } finally {
      setBusy(false)
      input.current?.focus()
    }
  }

  async function fromPhoto(file: File) {
    if (busy) return
    setError(null)
    setBusy(true)
    setStage('photo')
    try {
      // Shrink on the device: a phone's full-resolution photo is slow to send
      // and expensive to look at, for no gain in judging a plate of food.
      setPending(await estimateFromPhoto(await shrink(file)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'could not read that photo')
    } finally {
      setBusy(false)
      setStage('text')
    }
  }

  async function refine(feedback: string) {
    if (!pending) return
    setBusy(true)
    setError(null)
    try {
      setPending(await refineEstimate(pending.id, feedback))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'that did not work')
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (!pending) return
    setBusy(true)
    try {
      await commitEstimate(pending.id, pending.values)
      setPending(null)
      refreshAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'could not log that')
    } finally {
      setBusy(false)
    }
  }

  async function relog(description: string, values: Record<string, number>) {
    setBusy(true)
    try {
      await logDirect(description, values)
      refreshAll()
    } finally {
      setBusy(false)
    }
  }

  const totals = day.status === 'ok' ? day.data.totals : {}

  // Calories leads and gets its own bar; the rest are supporting numbers.
  const rest = fields.filter((field) => field.id !== 'calories')

  return (
    <div className="space-y-5">
      <CaloriesBar totals={totals} fields={fields} />

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
            disabled={busy || pending !== null}
            autoFocus
            enterKeyHint="done"
            placeholder="A number, or what you ate…"
            className="border-line bg-surface focus:border-accent w-full border py-3.5 pr-14 pl-4 text-base outline-none disabled:opacity-50"
          />

          {/* `capture` opens the camera straight away on a phone rather than the
              photo library, which is the whole point of the button. */}
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
            disabled={busy || pending !== null}
            aria-label="Photograph the meal instead"
            className="text-ink-dim hover:text-accent absolute inset-y-0 right-0 grid w-14 place-items-center disabled:opacity-50"
          >
            <Icon name="camera" className="!h-6 !w-6" />
          </button>
        </div>

        {busy && !pending && (
          <p className="text-ink-dim mt-2 animate-pulse font-mono text-xs">
            {stage === 'photo'
              ? 'looking at the photo — this takes a moment…'
              : 'estimating — this takes a few seconds…'}
          </p>
        )}
      </form>

      {error && (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      )}

      {pending && (
        <PendingCard
          pending={pending}
          fields={fields}
          busy={busy}
          onValues={(values) => setPending({ ...pending, values })}
          onRefine={refine}
          onSave={save}
          onDiscard={() => setPending(null)}
        />
      )}

      <div>
        <p className="text-ink-dim mb-2 text-[0.65rem] font-medium tracking-wide uppercase">
          Today
          {day.status === 'ok'
            ? ` · ${day.data.entries.length} ${day.data.entries.length === 1 ? 'log' : 'logs'}`
            : ''}
        </p>
        <Totals totals={totals} fields={rest} />
      </div>

      {promoted.status === 'ok' &&
        fields
          .filter((field) => field.onMain)
          .map((field) => (
            <Chart
              key={field.id}
              label={field.label}
              color={field.color}
              goal={field.goal}
              unit={field.unit}
              points={buildPoints(promoted.data, field.id) as Point[]}
            />
          ))}

      {!pending && recent.status === 'ok' && recent.data.length > 0 && (
        <div>
          <p className="text-ink-dim text-[0.65rem] font-medium tracking-wide uppercase">Again</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {recent.data.map((meal) => (
              <button
                key={meal.description}
                type="button"
                onClick={() => relog(meal.description, meal.values)}
                disabled={busy}
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
