import type { DayTotals } from './api'
import type { Point } from './points'

/**
 * Stats the Reports tab draws from a dense point list. Averages and hit-rates
 * are over days that actually have data — dividing by the whole window would
 * report a number you never ate.
 */

type LoggedPoint = Point & { value: number }

export function logged(points: Point[]): LoggedPoint[] {
  return points.filter((point): point is LoggedPoint => point.value !== null)
}

export function averageOf(points: Point[]): number | null {
  const values = logged(points)
  if (values.length === 0) return null
  return values.reduce((sum, point) => sum + point.value, 0) / values.length
}

/** Calories are a ceiling when cutting: at or under is on track. */
export function daysAtOrUnder(points: Point[], goal: number): number {
  return logged(points).filter((point) => point.value <= goal).length
}

/** Protein (and similar floors): at or over is a hit. */
export function daysAtOrOver(days: DayTotals[], fieldId: string, goal: number): number {
  return days.filter((day) => {
    const value = day.totals[fieldId]
    return typeof value === 'number' && value >= goal
  }).length
}

export function weekdayAverages(
  points: Point[],
): Array<{ weekday: number; average: number | null }> {
  const buckets: number[][] = [[], [], [], [], [], [], []]
  for (const point of logged(points)) {
    const [y, m, d] = point.date.split('-').map(Number)
    const weekday = new Date(y, m - 1, d, 12).getDay()
    buckets[weekday]?.push(point.value)
  }
  return buckets.map((values, weekday) => ({
    weekday,
    average:
      values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length,
  }))
}
