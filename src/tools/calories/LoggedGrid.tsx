import { useEffect, useRef } from 'react'
import { weekdaySunday } from '@shared/calories'
import type { RangeWindow } from './api'
import { eachDay } from './points'

/**
 * A day-per-cell grid of whether you logged, and whether you were on the
 * calorie goal. Hue is on-track vs over, not "more calories is better" — a
 * solid wall of over would look like a GitHub streak and mean the opposite.
 */

type Kind = 'empty' | 'logged' | 'under' | 'over'

function kindFor(totals: Record<string, number> | undefined, calorieGoal: number | null): Kind {
  if (!totals || !('calories' in totals)) return 'empty'
  if (calorieGoal === null) return 'logged'
  return totals.calories <= calorieGoal ? 'under' : 'over'
}

const FILL: Record<Kind, string> = {
  empty: '',
  logged: 'bg-accent',
  under: 'bg-accent',
  over: 'bg-danger',
}

/** Stripes on "over" so hue is never the only encoding. */
const HATCH = {
  backgroundImage:
    'repeating-linear-gradient(-45deg, transparent, transparent 2px, rgb(255 255 255 / 0.45) 2px, rgb(255 255 255 / 0.45) 3px)',
}

const LABEL: Record<Kind, string> = {
  empty: 'not logged',
  logged: 'logged',
  under: 'on track',
  over: 'over',
}

export function LoggedGrid({
  range,
  calorieGoal,
  onOpen,
}: {
  range: RangeWindow
  calorieGoal: number | null
  onOpen: (date: string) => void
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const byDate = new Map(range.days.map((day) => [day.date, day.totals]))
  const dates = eachDay(range.from, range.to)
  const lead = weekdaySunday(dates[0] ?? range.from)
  const cell = 12
  const gap = 3

  useEffect(() => {
    const element = scroller.current
    if (element) element.scrollLeft = element.scrollWidth
  }, [range.from, range.to, dates.length])

  if (dates.length === 0) return null

  return (
    <div>
      <p className="text-ink-dim text-xs tracking-wide uppercase">
        {calorieGoal !== null ? 'Days on the calorie goal' : 'Days logged'}
      </p>
      <div ref={scroller} className="mt-2 overflow-x-auto">
        <div
          className="grid w-max"
          style={{
            gridTemplateRows: `repeat(7, ${cell}px)`,
            gridAutoFlow: 'column',
            gridAutoColumns: `${cell}px`,
            gap,
          }}
        >
          {Array.from({ length: lead }, (_, index) => (
            <span key={`lead-${index}`} aria-hidden="true" />
          ))}
          {dates.map((date) => {
            const kind = kindFor(byDate.get(date), calorieGoal)
            const kcal = byDate.get(date)?.calories
            return (
              <button
                key={date}
                type="button"
                onClick={() => onOpen(date)}
                title={
                  kcal !== undefined
                    ? `${date} · ${Math.round(kcal)} · ${LABEL[kind]}`
                    : `${date} · ${LABEL[kind]}`
                }
                aria-label={
                  kcal !== undefined
                    ? `${date}, ${Math.round(kcal)} calories, ${LABEL[kind]}`
                    : `${date}, ${LABEL[kind]}`
                }
                className={kind === 'empty' ? 'bg-line/60' : FILL[kind]}
                style={kind === 'over' ? HATCH : undefined}
              />
            )
          })}
        </div>
      </div>
      <ul className="text-ink-dim mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.65rem]">
        {calorieGoal !== null ? (
          <>
            <li className="flex items-center gap-1.5">
              <span aria-hidden="true" className="bg-accent size-2.5" />
              on track
            </li>
            <li className="flex items-center gap-1.5">
              <span aria-hidden="true" className="bg-danger size-2.5" style={HATCH} />
              over
            </li>
          </>
        ) : (
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className="bg-accent size-2.5" />
            logged
          </li>
        )}
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="bg-line/60 size-2.5" />
          not logged
        </li>
      </ul>
    </div>
  )
}
