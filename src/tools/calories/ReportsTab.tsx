import { useState } from 'react'
import type {
  DigestionRangeData,
  Expenditure,
  FieldConfig,
  RangeKey,
  Settings,
  Suspect,
} from '@shared/calories'
import { KCAL_PER_LB, RANGE_LABELS, dayKeyFromMs } from '@shared/calories'
import { usePolled } from '../../lib/refresh'
import {
  getDigestionPatterns,
  getDigestionRange,
  getLogView,
  getRange,
  getSuspects,
  getWeight,
  tracked,
  withEffectiveGoal,
  type DigestionWindow,
  type WeightData,
} from './api'
import { Chart } from './Chart'
import { LoggedGrid } from './LoggedGrid'
import { composition } from './macros'
import {
  buildPoints,
  eachDay,
  rollingMean,
  weekLoggedDays,
  weeklyPoints,
  type Point,
} from './points'
import { averageOf, daysAtOrOver, daysAtOrUnder, logged, weekdayAverages } from './reports'
import { WeekProgress } from './WeekProgress'
import { WeightBar } from './WeightBar'

/**
 * Analysis, sectioned rather than one long scroll — nutrition, weight, and
 * digestion each get their own range/pattern views instead of crowding a
 * single page. Logging (meals, weigh-ins, digestion episodes) lives on Today;
 * browsing specific days lives on Log. This tab is purely "how's it going."
 */

const SECTIONS = ['Nutrition', 'Weight', 'Digestion'] as const
type Section = (typeof SECTIONS)[number]

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
  const high = points.reduce(
    (best, point) =>
      point.average !== null && (best.average === null || point.average > best.average)
        ? point
        : best,
    points[0] ?? { weekday: 0, average: null },
  )
  const low = points.reduce(
    (best, point) =>
      point.average !== null && (best.average === null || point.average < best.average)
        ? point
        : best,
    points[0] ?? { weekday: 0, average: null },
  )

  return (
    <div
      role="img"
      aria-label={
        high.average !== null && low.average !== null
          ? `Calories by weekday. Highest ${WEEKDAYS[high.weekday]} at ${Math.round(high.average)}${suffix}. Lowest ${WEEKDAYS[low.weekday]} at ${Math.round(low.average)}${suffix}.${spread > 0 ? ' Scale starts near the lowest day, not zero.' : ''}`
          : 'Calories by weekday. Nothing logged.'
      }
    >
      <p className="text-ink-dim text-xs tracking-wide uppercase">Which weekdays run high</p>
      <div className="mt-2 grid grid-cols-7 gap-1">
        {points.map((point) => (
          <div key={point.weekday} className="flex flex-col items-center gap-1">
            <div className="flex h-16 w-full items-end">
              {point.average !== null ? (
                <span
                  className="bg-accent w-full"
                  style={{ height: `${Math.max(8, ((point.average - base) / span) * 100)}%` }}
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
      {spread > 0 && (
        <p className="text-ink-dim mt-2 text-[0.65rem]">
          Bars start near the lowest day, not zero.
        </p>
      )}
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
        const captions = [
          trend ? 'Fainter line is a 7-day mean.' : null,
          long && calories
            ? 'Weeks with unlogged days are dimmed. Totals skip those days rather than filling them with zero.'
            : null,
        ].filter((line): line is string => Boolean(line))
        const legend =
          calories && !long
            ? (['protein', 'fat', 'carbs'] as const)
                .map((id) => fields.find((item) => item.id === id))
                .filter((item): item is FieldConfig => Boolean(item))
                .map((item) => ({ color: item.color, label: item.label }))
            : undefined

        return (
          <section key={field.id} className="border-line bg-surface border px-4 py-3">
            <Chart
              label={long && calories ? `${field.label} per week` : `${field.label} per day`}
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
              legend={legend}
              caption={captions.length > 0 ? captions.join(' ') : undefined}
            />
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

function NutritionSection({
  settings,
  expenditure,
  onOpenDay,
}: {
  settings: Settings | null
  expenditure: Expenditure | null
  onOpenDay: (date: string) => void
}) {
  const [range, setRange] = useState<RangeKey>('fortnight')
  const [today] = useState(() => dayKeyFromMs(Date.now()))
  const week = usePolled('event-driven', () => getLogView('week', today))
  const fields = withEffectiveGoal(tracked(settings), settings, expenditure)
  const calorieGoal = fields.find((field) => field.id === 'calories')?.goal ?? null
  const protein = fields.find((field) => field.id === 'protein' && field.tracked)

  return (
    <div className="space-y-5">
      {week.status === 'ok' && fields.length > 0 && (
        <WeekProgress
          totals={week.data.totals}
          fields={fields}
          today={today}
          tdee={expenditure?.tdee ?? null}
          rateLbPerWeek={settings?.weight.rateLbPerWeek ?? 1}
          daysLogged={week.data.summary.daysLogged}
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

const TREND_COLOR = '#2393dd'

function WeightSection({ settings, data }: { settings: Settings | null; data: WeightData }) {
  const { readings, trend, expenditure } = data
  const config = settings?.weight

  return (
    <div className="space-y-5">
      {config && (
        <WeightBar settings={config} expenditure={expenditure} startLb={trend[0]?.lb ?? null} />
      )}

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
            expenditure.status === 'learning'
              ? `${expenditure.daysNeeded} more days`
              : expenditure.tdee !== null
                ? `${expenditure.tdee * 7} / week`
                : 'kcal/day'
          }
        />
        <Figure
          label="Target"
          value={expenditure.target !== null ? String(expenditure.target) : '—'}
          hint={
            expenditure.atGoal
              ? 'holding at goal'
              : expenditure.target !== null
                ? `${expenditure.target * 7} / week`
                : 'kcal/day'
          }
        />
        <Figure
          label="Rate"
          value={expenditure.ratePerWeek !== null ? `${expenditure.ratePerWeek.toFixed(2)}` : '—'}
          hint={expenditure.projectedDate ? `goal ${expenditure.projectedDate}` : 'lb/week'}
        />
      </div>

      {expenditure.target !== null && !expenditure.atGoal && (
        <p className="text-ink-dim text-sm">
          A {config?.rateLbPerWeek ?? 1} lb week is a {(config?.rateLbPerWeek ?? 1) * KCAL_PER_LB}{' '}
          kcal deficit.
          {expenditure.tdee !== null
            ? ` Burns ${expenditure.tdee * 7} · eat ${expenditure.target * 7}.`
            : ''}
        </p>
      )}

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
            baseline="fit"
            points={trend.map((point) => ({ date: point.date, value: point.lb }))}
          />
        </section>
      )}

      {readings.length === 0 && (
        <p className="text-ink-dim text-sm">
          Nothing logged yet — weigh in from Today, or add a past reading from Log.
        </p>
      )}
    </div>
  )
}

function buildEpisodePoints(window: DigestionRangeData): Point[] {
  const byDate = new Map(window.days.map((day) => [day.date, day.count]))
  return eachDay(window.from, window.to).map((date) => ({ date, value: byDate.get(date) ?? 0 }))
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

/** Bars scaled relative to the busiest bucket rather than to an absolute
 *  count — the shape is the point, not the number. Same "start a little below
 *  the lowest bar" trick as WeekdayRow, so the smallest bucket still reads as
 *  present rather than invisible. */
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

const DAYPARTS = ['Morning', 'Afternoon', 'Evening', 'Night']

function DigestionPatternsSection({ window }: { window: DigestionWindow }) {
  const data = usePolled('event-driven', () => getDigestionPatterns(window))

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

function SuspectsPanel({ window }: { window: DigestionWindow }) {
  const suspects = usePolled('event-driven', () => getSuspects(window))

  return (
    <>
      {suspects.status === 'loading' && <p className="text-ink-dim text-sm">loading…</p>}
      {suspects.status === 'error' && <p className="text-danger text-sm">{suspects.message}</p>}
      {suspects.status === 'ok' && (
        <>
          <SuspectList title="Same day" suspects={suspects.data.sameDay} />
          <SuspectList title="Next day" suspects={suspects.data.nextDay} />
          <SuspectList title="Two days out" suspects={suspects.data.twoDaysOut} />
        </>
      )}
    </>
  )
}

const WINDOWS: DigestionWindow[] = [...RANGES, 'all']

/** One window governs the whole section — the chart, the patterns and the
 *  suspects all describe the same stretch of time. "All" has no range of its
 *  own for the chart, so it shows the last year. */
function DigestionSection() {
  const [window, setWindow] = useState<DigestionWindow>('all')

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {WINDOWS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setWindow(key)}
            aria-pressed={window === key}
            className={`min-h-11 border px-3 text-sm ${
              window === key
                ? 'border-accent text-accent'
                : 'border-line hover:border-accent bg-surface'
            }`}
          >
            {key === 'all' ? 'All' : RANGE_LABELS[key]}
          </button>
        ))}
      </div>

      <section className="border-line bg-surface border px-4 py-3">
        <EpisodesChart key={window} range={window === 'all' ? 'year' : window} />
      </section>

      <section className="border-line bg-surface border px-4 py-3">
        <DigestionPatternsSection key={window} window={window} />
      </section>

      <section className="border-line bg-surface space-y-5 border px-4 py-3">
        <p className="text-sm font-semibold tracking-tight">Suspected foods</p>
        <SuspectsPanel key={window} window={window} />
      </section>
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
  const [section, setSection] = useState<Section>('Nutrition')
  const weight = usePolled('event-driven', getWeight)
  const expenditure: Expenditure | null = weight.status === 'ok' ? weight.data.expenditure : null

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {SECTIONS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setSection(key)}
            aria-pressed={section === key}
            className={`min-h-11 border px-3 text-sm font-medium ${
              section === key
                ? 'border-accent text-accent'
                : 'border-line hover:border-accent bg-surface'
            }`}
          >
            {key}
          </button>
        ))}
      </div>

      {section === 'Nutrition' && (
        <NutritionSection settings={settings} expenditure={expenditure} onOpenDay={onOpenDay} />
      )}
      {section === 'Weight' &&
        (weight.status === 'ok' ? (
          <WeightSection settings={settings} data={weight.data} />
        ) : weight.status === 'error' ? (
          <p className="text-danger text-sm">{weight.message}</p>
        ) : (
          <p className="text-ink-dim text-sm">loading…</p>
        ))}
      {section === 'Digestion' && <DigestionSection />}
    </div>
  )
}
