import { useState } from 'react'
import type { Expenditure, FieldConfig, RangeKey, Settings } from '@shared/calories'
import { RANGE_LABELS, dayKeyFromMs, startOfWeek } from '@shared/calories'
import { usePolled } from '../../lib/refresh'
import { getDay, getLogView, getRange, getWeight, tracked, withEffectiveGoal } from './api'
import { Chart } from './Chart'
import { LoggedGrid } from './LoggedGrid'
import { composition } from './macros'
import { buildPoints, rollingMean, weekLoggedDays, weeklyPoints } from './points'
import { averageOf, daysAtOrOver, daysAtOrUnder, logged, weekdayAverages } from './reports'
import { WeekProgress } from './WeekProgress'

/**
 * How the stretch of days is going — not a gallery of lines.
 *
 * This calendar week sits above the chosen range: the week is the unit a cut
 * actually runs on (3,500 kcal = 1 lb), and the range is what you look back
 * through. Missing days stay unknown; averages are over days that have data.
 */

const RANGES: RangeKey[] = ['week', 'fortnight', 'month', 'quarter', 'half', 'year']
const DAILY_LIMIT = 31
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border-line bg-surface border p-3">
      <p className="text-ink-dim text-[0.6rem] font-medium tracking-wide uppercase">{label}</p>
      <p className="mt-1 font-mono text-xl tabular-nums">{value}</p>
      {hint && <p className="text-ink-dim mt-0.5 font-mono text-[0.65rem]">{hint}</p>}
    </div>
  )
}

function WeekdayRow({
  points,
  unit,
}: {
  points: ReturnType<typeof weekdayAverages>
  unit: string
}) {
  const values = points
    .map((point) => point.average)
    .filter((value): value is number => value !== null)
  const peak = Math.max(...values, 1)
  const floor = Math.min(...values, peak)
  // Scale from a little below the lowest day, not from zero — otherwise 1,900
  // and 2,400 both sit at ~80% and the whole point of the row is gone.
  const spread = peak - floor
  const base = spread > 0 ? floor - spread * 0.2 : 0
  const span = peak - base || 1
  const suffix = unit === 'kcal' ? '' : unit

  return (
    <div>
      <p className="text-ink-dim text-xs tracking-wide uppercase">By weekday</p>
      <div className="mt-2 grid grid-cols-7 gap-1">
        {points.map((point) => (
          <div key={point.weekday} className="flex flex-col items-center gap-1">
            <div className="flex h-16 w-full items-end">
              {point.average !== null ? (
                <span
                  className="bg-accent w-full"
                  style={{ height: `${Math.max(8, ((point.average - base) / span) * 100)}%` }}
                  title={`${WEEKDAYS[point.weekday]} · ${Math.round(point.average)}${suffix}`}
                />
              ) : (
                <span className="bg-line/60 h-px w-full" />
              )}
            </div>
            <span className="font-mono text-[0.65rem] tabular-nums">
              {point.average !== null ? Math.round(point.average) : '—'}
            </span>
            <span className="text-ink-dim font-mono text-[0.65rem]">{WEEKDAYS[point.weekday]}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function RangeBody({
  range,
  fields,
  calorieGoal,
  protein,
  tdee,
  onOpenDay,
}: {
  range: RangeKey
  fields: FieldConfig[]
  calorieGoal: number | null
  protein: FieldConfig | undefined
  tdee: number | null
  onOpenDay: (date: string) => void
}) {
  const data = usePolled('event-driven', () => getRange(range))

  if (data.status === 'loading') return <p className="text-ink-dim text-sm">loading…</p>
  if (data.status === 'error') return <p className="text-danger text-sm">{data.message}</p>

  const window = data.data
  const caloriePoints = buildPoints(window, 'calories')
  const previousCalorie = buildPoints(window.previous, 'calories')
  const long = caloriePoints.length > DAILY_LIMIT
  const daysInWindow = caloriePoints.length
  const loggedDays = logged(caloriePoints).length
  const avg = averageOf(caloriePoints)
  const priorAvg = averageOf(previousCalorie)
  const onTrack = calorieGoal !== null ? daysAtOrUnder(caloriePoints, calorieGoal) : null
  const proteinHits =
    protein?.goal != null ? daysAtOrOver(window.days, 'protein', protein.goal) : null
  const colors = Object.fromEntries(fields.map((field) => [field.id, field.color]))

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Figure label="Logged" value={`${loggedDays}/${daysInWindow}`} hint="days with food" />
        {onTrack !== null && (
          <Figure
            label="On track"
            value={String(onTrack)}
            hint={loggedDays > 0 ? `of ${loggedDays} logged` : 'at or under goal'}
          />
        )}
        {proteinHits !== null && protein && (
          <Figure
            label={protein.label}
            value={String(proteinHits)}
            hint={loggedDays > 0 ? `days hit ${protein.goal}${protein.unit}` : 'floor'}
          />
        )}
        <Figure
          label="Average"
          value={avg !== null ? String(Math.round(avg)) : '—'}
          hint={
            [
              calorieGoal !== null ? `goal ${calorieGoal}` : null,
              priorAvg !== null ? `prior ${Math.round(priorAvg)}` : null,
            ]
              .filter(Boolean)
              .join(' · ') || undefined
          }
        />
      </div>

      <section className="border-line bg-surface border px-4 py-3">
        <LoggedGrid range={window} calorieGoal={calorieGoal} onOpen={onOpenDay} />
      </section>

      <section className="border-line bg-surface border px-4 py-3">
        <WeekdayRow points={weekdayAverages(caloriePoints)} unit="kcal" />
      </section>

      {fields.map((field) => {
        const daily = buildPoints(window, field.id)
        const previousAvg = averageOf(buildPoints(window.previous, field.id))
        const calories = field.id === 'calories'
        const points = long ? weeklyPoints(daily, calories ? 'sum' : 'average') : daily
        const average = averageOf(points)
        const goal = long && calories && field.goal ? field.goal * 7 : field.goal
        const trend = !long && daily.length > 7 ? rollingMean(daily) : undefined
        const faint = long
          ? points.map((point) => weekLoggedDays(daily, point.date) < 7)
          : undefined
        const stacks =
          !long && calories
            ? daily.map((point) => {
                if (point.value === null) return null
                const totals = window.days.find((day) => day.date === point.date)?.totals ?? {}
                const { segments } = composition(totals, colors)
                return segments.map((segment) => ({ color: segment.color, share: segment.share }))
              })
            : undefined
        const markers: { value: number; label: string }[] = []
        if (calories && tdee !== null) {
          const burns = long ? tdee * 7 : tdee
          if (goal === null || Math.abs(burns - goal) >= 1) {
            markers.push({ value: burns, label: `burns ${Math.round(burns)}` })
          }
        }

        return (
          <section key={field.id} className="border-line bg-surface border px-4 py-3">
            <Chart
              label={long && calories ? `${field.label} · weekly` : field.label}
              color={field.color}
              goal={goal}
              unit={field.unit}
              points={points}
              trend={trend}
              markers={markers.length > 0 ? markers : undefined}
              mode={calories ? 'bar' : 'line'}
              faint={faint}
              stacks={stacks}
              onOpen={onOpenDay}
            />
            {long && calories && (
              <p className="text-ink-dim mt-2 text-[0.65rem]">
                Weeks with unlogged days are dimmed. Totals skip those days rather than filling them
                with zero.
              </p>
            )}
            <dl className="border-line mt-3 flex items-baseline justify-between border-t pt-3">
              <dt className="text-ink-dim text-xs tracking-wide uppercase">
                Average{long && calories ? ' week' : ` · ${RANGE_LABELS[range].toLowerCase()}`}
              </dt>
              <dd className="font-mono text-sm tabular-nums">
                {average !== null ? Math.round(average) : '—'}
                {field.unit === 'kcal' ? '' : field.unit}
                <span className="text-ink-dim ml-2 text-xs">
                  over{' '}
                  {long
                    ? `${points.length} week${points.length === 1 ? '' : 's'}`
                    : `${logged(daily).length} day${logged(daily).length === 1 ? '' : 's'}`}
                  {goal !== null && average !== null ? ` · goal ${Math.round(goal)}` : ''}
                  {previousAvg !== null && average !== null
                    ? ` · prior ${Math.round(previousAvg)}`
                    : ''}
                </span>
              </dd>
            </dl>
          </section>
        )
      })}
    </div>
  )
}

export function ReportsTab({
  settings,
  onOpenDay,
}: {
  settings: Settings | null
  onOpenDay: (date: string) => void
}) {
  const [range, setRange] = useState<RangeKey>('fortnight')
  const [today] = useState(() => dayKeyFromMs(Date.now()))
  const weight = usePolled('event-driven', getWeight)
  const week = usePolled('event-driven', () => getLogView('week', today))
  const day = usePolled('ambient', getDay)
  const expenditure: Expenditure | null = weight.status === 'ok' ? weight.data.expenditure : null
  const fields = withEffectiveGoal(tracked(settings), settings, expenditure)
  const calorieGoal = fields.find((field) => field.id === 'calories')?.goal ?? null
  const protein = fields.find((field) => field.id === 'protein' && field.tracked)

  const pending =
    day.status === 'ok' && day.data.date >= startOfWeek(today) ? day.data.pendingTotals : undefined
  const extraPendingDay =
    pending &&
    (pending.calories ?? 0) > 0 &&
    week.status === 'ok' &&
    !week.data.loggedDays.includes(today)
      ? 1
      : 0

  return (
    <div className="space-y-5">
      {week.status === 'ok' && fields.length > 0 && (
        <WeekProgress
          totals={week.data.totals}
          pendingTotals={pending}
          fields={fields}
          today={today}
          tdee={expenditure?.tdee ?? null}
          rateLbPerWeek={settings?.weight.rateLbPerWeek ?? 1}
          daysLogged={week.data.summary.daysLogged + extraPendingDay}
          atGoal={expenditure?.atGoal ?? false}
        />
      )}

      <div className="flex flex-wrap gap-2">
        {RANGES.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setRange(key)}
            aria-pressed={range === key}
            className={`min-h-11 border px-3 text-sm transition-colors ${
              range === key
                ? 'border-accent text-accent'
                : 'border-line hover:border-accent bg-surface'
            }`}
          >
            {RANGE_LABELS[key]}
          </button>
        ))}
      </div>

      <RangeBody
        key={range}
        range={range}
        fields={fields}
        calorieGoal={calorieGoal}
        protein={protein}
        tdee={expenditure?.tdee ?? null}
        onOpenDay={onOpenDay}
      />
    </div>
  )
}
