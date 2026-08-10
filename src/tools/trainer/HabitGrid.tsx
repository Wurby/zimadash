import { useEffect, useRef } from 'react'
import { parseDay, type DayCell, type SessionType } from '@shared/trainer'

/**
 * A day-per-cell grid of what you've trained, GitHub-style.
 *
 * **Hue is the session type, not the amount.** The habit worth watching form
 * here isn't "did I train" — it's the rotation becoming regular. A month where
 * legs quietly got skipped is visibly wrong in three colours and completely
 * invisible in one.
 *
 * Intensity is how hard the session was, averaged from the ratings, so an easy
 * week and a brutal one don't look identical.
 *
 * One thing the metaphor gets wrong if you let it: a contribution grid implies
 * every filled day is better, which is false here — rest is the programme, and
 * a solid wall would mean overtraining. So this is texture, and the habit is
 * counted in weeks alongside it.
 */

/** A tool's own data colours are exempt from slate-and-sky, and three session
 *  types need three hues to be told apart at cell size. */
const HUE: Record<SessionType, string> = {
  'Upper A': 'oklch(60.6% 0.25 292.717)', // violet-500
  'Upper B': 'oklch(70.4% 0.14 182.503)', // teal-500
  Lower: 'oklch(76.9% 0.188 70.08)', // amber-500
}

const TYPE_ORDER: SessionType[] = ['Upper A', 'Lower', 'Upper B']

/** Four steps, so a light day and a hard one differ without inventing
 *  precision the ratings don't have. */
function opacityFor(effort: number): number {
  if (effort >= 0.75) return 1
  if (effort >= 0.55) return 0.8
  if (effort >= 0.35) return 0.6
  return 0.45
}

function weekdayOf(iso: string): number {
  return (parseDay(iso).getDay() + 6) % 7 // Monday = 0
}

export function HabitGrid({
  cells,
  cell = 10,
  weeks,
  onPick,
}: {
  cells: DayCell[]
  /** Side of one day, in px. */
  cell?: number
  /** Trim to the most recent N weeks. Omit for everything given. */
  weeks?: number
  onPick?: (day: DayCell) => void
}) {
  const scroller = useRef<HTMLDivElement>(null)

  // The interesting end is the recent one, so start scrolled to it.
  useEffect(() => {
    const element = scroller.current
    if (element) element.scrollLeft = element.scrollWidth
  }, [cells.length])

  if (cells.length === 0) return null

  const trimmed = weeks ? cells.slice(-(weeks * 7)) : cells
  const first = trimmed[0]
  if (!first) return null

  // Pad so the first column starts on a Monday rather than mid-week.
  const lead = weekdayOf(first.date)
  const gap = Math.max(1, Math.round(cell / 5))

  return (
    <div ref={scroller} className="overflow-x-auto">
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

        {trimmed.map((day) =>
          day.type ? (
            <button
              key={day.date}
              type="button"
              onClick={onPick ? () => onPick(day) : undefined}
              title={`${day.date} — ${day.type}`}
              aria-label={`${day.date}, ${day.type}`}
              style={{ background: HUE[day.type], opacity: opacityFor(day.effort) }}
              className={onPick ? 'cursor-pointer' : 'cursor-default'}
            />
          ) : (
            <span key={day.date} className="bg-line/60" title={day.date} />
          ),
        )}
      </div>
    </div>
  )
}

/** Named colours, so the grid's hues are readable as something. */
export function HabitLegend() {
  return (
    <ul className="text-ink-dim flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.65rem]">
      {TYPE_ORDER.map((type) => (
        <li key={type} className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2.5" style={{ background: HUE[type] }} />
          {type}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <span aria-hidden="true" className="bg-line/60 size-2.5" />
        rest
      </li>
    </ul>
  )
}
