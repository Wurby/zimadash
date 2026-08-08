import { useState } from 'react'
import type { LossRate, Settings } from '@shared/calories'
import { usePolled } from '../../lib/refresh'
import { deleteWeight, getWeight, putWeight, putSettings, resetBaseline } from './api'
import { Chart } from './Chart'

/**
 * Weigh-ins, the trend, and what the tool has learned from them.
 *
 * The graph plots the smoothed trend, not the raw readings — a morning weight
 * swings pounds on water alone, and the raw line makes a steady loss look like
 * noise. The readings are still all there in the list below.
 */

const RATES: LossRate[] = [1, 1.5, 2]
const TREND_COLOR = '#2393dd'

const pad = (n: number) => String(n).padStart(2, '0')
const todayKey = () => {
  const d = new Date()
  // Matches the server's 4am rollover, so a pre-dawn weigh-in files where the
  // rest of that night's food went.
  if (d.getHours() < 4) d.setDate(d.getDate() - 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border-line bg-surface border p-3">
      <p className="text-ink-dim text-[0.6rem] font-medium tracking-wide uppercase">{label}</p>
      <p className="mt-1 font-mono text-xl tabular-nums">{value}</p>
      {hint && <p className="text-ink-dim mt-0.5 font-mono text-[0.65rem]">{hint}</p>}
    </div>
  )
}

export function WeightTab({
  settings,
  onSaved,
}: {
  settings: Settings | null
  onSaved: (next: Settings) => void
}) {
  const weight = usePolled('event-driven', getWeight)
  const [entry, setEntry] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [span, setSpan] = useState<7 | 30>(30)

  const config = settings?.weight

  async function log() {
    const lb = Number(entry)
    if (!Number.isFinite(lb) || lb <= 0 || busy) return
    setBusy(true)
    try {
      await putWeight(todayKey(), lb)
      setEntry('')
      weight.refresh()
    } finally {
      setBusy(false)
    }
  }

  async function save(next: Partial<NonNullable<typeof config>>) {
    if (!settings) return
    onSaved(await putSettings({ ...settings, weight: { ...settings.weight, ...next } }))
    weight.refresh()
  }

  async function remove(date: string) {
    await deleteWeight(date)
    weight.refresh()
  }

  if (weight.status === 'loading') return <p className="text-ink-dim text-sm">loading…</p>
  if (weight.status === 'error') return <p className="text-danger text-sm">{weight.message}</p>

  const { readings, trend, expenditure } = weight.data
  const recent = [...readings].reverse().slice(0, span)

  return (
    <div className="space-y-5">
      <div className="flex gap-2">
        <input
          value={entry}
          onChange={(event) => setEntry(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && void log()}
          inputMode="decimal"
          disabled={busy}
          placeholder="This morning's weight, in lb…"
          className="border-line bg-surface focus:border-accent min-w-0 flex-1 border px-4 py-3 text-base outline-none disabled:opacity-50"
        />
        <button
          type="button"
          onClick={log}
          disabled={busy || !entry.trim()}
          className="bg-accent px-4 py-3 text-sm font-medium text-slate-50 disabled:opacity-50 dark:text-slate-900"
        >
          Log
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Figure
          label="Trend"
          value={expenditure.trendLb !== null ? `${expenditure.trendLb.toFixed(1)}` : '—'}
          hint="lb, smoothed"
        />
        <Figure
          label="Burns"
          value={expenditure.tdee !== null ? String(expenditure.tdee) : '—'}
          hint={
            expenditure.status === 'learning' ? `${expenditure.daysNeeded} more days` : 'kcal/day'
          }
        />
        <Figure
          label="Target"
          value={expenditure.target !== null ? String(expenditure.target) : '—'}
          hint={expenditure.atGoal ? 'holding at goal' : 'kcal/day'}
        />
        <Figure
          label="Rate"
          value={expenditure.ratePerWeek !== null ? `${expenditure.ratePerWeek.toFixed(2)}` : '—'}
          hint={expenditure.projectedDate ? `goal ${expenditure.projectedDate}` : 'lb/week'}
        />
      </div>

      {expenditure.status === 'learning' && (
        <p className="text-ink-dim text-sm">
          Still learning — it needs {expenditure.daysNeeded} more day
          {expenditure.daysNeeded === 1 ? '' : 's'} with both food and a weigh-in logged before it
          will trust a number. Your hand-set goal stays in charge until then.
        </p>
      )}

      {expenditure.excluded > 0 && (
        <p className="text-ink-dim text-sm">
          {expenditure.excluded} day{expenditure.excluded === 1 ? '' : 's'} looked under-logged and
          {expenditure.excluded === 1 ? ' was' : ' were'} left out of the expenditure maths. They
          are still in your log and your reports.
        </p>
      )}

      {trend.length > 1 && (
        <section className="border-line bg-surface border px-4 py-3">
          <Chart
            label="Trend"
            color={TREND_COLOR}
            goal={config?.goalLb ?? null}
            unit="lb"
            points={trend.map((point) => ({ date: point.date, value: point.lb }))}
          />
        </section>
      )}

      <div className="border-line space-y-3 border p-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-ink-dim text-xs tracking-wide uppercase">Goal</span>
            <input
              type="text"
              inputMode="decimal"
              defaultValue={config?.goalLb ?? ''}
              onBlur={(event) =>
                void save({ goalLb: event.target.value === '' ? null : Number(event.target.value) })
              }
              placeholder="lb"
              className="border-line focus:border-accent w-24 border bg-transparent px-2 py-1 font-mono text-sm outline-none"
            />
          </label>

          <div className="flex items-center gap-1.5">
            <span className="text-ink-dim text-xs tracking-wide uppercase">Rate</span>
            {RATES.map((rate) => (
              <button
                key={rate}
                type="button"
                onClick={() => void save({ rateLbPerWeek: rate })}
                aria-pressed={config?.rateLbPerWeek === rate}
                className={`border px-2 py-1 font-mono text-xs ${
                  config?.rateLbPerWeek === rate
                    ? 'border-accent text-accent'
                    : 'border-line hover:border-accent'
                }`}
              >
                {rate}
              </button>
            ))}
            <span className="text-ink-dim text-xs">lb/wk</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              if (!confirming) {
                setConfirming(true)
                return
              }
              setConfirming(false)
              void resetBaseline().then(onSaved).then(weight.refresh)
            }}
            onBlur={() => setConfirming(false)}
            className={`border px-3 py-1.5 text-xs ${
              confirming ? 'border-danger text-danger' : 'border-line hover:border-accent'
            }`}
          >
            {confirming ? 'Relearn from today?' : 'Reset to baseline'}
          </button>
          <p className="text-ink-dim text-xs">
            Starts the expenditure maths again from today. Nothing is deleted.
            {config?.baselineDate ? ` Currently learning from ${config.baselineDate}.` : ''}
          </p>
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center gap-2">
          <p className="text-ink-dim text-[0.65rem] font-medium tracking-wide uppercase">
            Readings
          </p>
          <div className="ml-auto flex gap-1">
            {([7, 30] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setSpan(option)}
                aria-pressed={span === option}
                className={`border px-2 py-0.5 text-xs ${
                  span === option ? 'border-accent text-accent' : 'border-line hover:border-accent'
                }`}
              >
                {option === 7 ? 'Week' : 'Month'}
              </button>
            ))}
          </div>
        </div>

        {recent.length === 0 ? (
          <p className="text-ink-dim text-sm">Nothing logged yet.</p>
        ) : (
          <ul className="divide-line divide-y">
            {recent.map((reading) => (
              <li key={reading.date} className="flex items-center gap-3 py-2">
                <span className="text-ink-dim font-mono text-xs tabular-nums">{reading.date}</span>
                <input
                  type="text"
                  inputMode="decimal"
                  defaultValue={reading.lb}
                  onBlur={(event) => {
                    const lb = Number(event.target.value)
                    if (Number.isFinite(lb) && lb > 0 && lb !== reading.lb) {
                      void putWeight(reading.date, lb).then(weight.refresh)
                    }
                  }}
                  className="border-line focus:border-accent ml-auto w-20 border bg-transparent px-2 py-1 text-right font-mono text-sm outline-none"
                />
                <button
                  type="button"
                  onClick={() => void remove(reading.date)}
                  aria-label={`Delete the reading for ${reading.date}`}
                  className="border-line hover:border-danger border px-2 py-1 text-xs"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
