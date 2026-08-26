import { endOfWeek, startOfWeek } from '@shared/calories'
import type { RangeWindow } from './api'

export interface Point {
  date: string
  value: number | null
}

/**
 * Turn the server's sparse day list into a dense one, with `null` where a day
 * has no entry.
 *
 * The server only sends days that have data. Filling the gaps with zero would
 * draw a day of fasting that never happened, so they stay null and the line
 * breaks instead — which is also what makes a newly added field's line start
 * where its data does rather than crawling along the axis first.
 */

const pad = (n: number): string => String(n).padStart(2, '0')

export function eachDay(from: string, to: string): string[] {
  const [fy, fm, fd] = from.split('-').map(Number)
  const days: string[] = []

  // Noon, so a daylight-saving shift can't roll a date backwards.
  for (const cursor = new Date(fy, fm - 1, fd, 12); ; cursor.setDate(cursor.getDate() + 1)) {
    const key = `${cursor.getFullYear()}-${pad(cursor.getMonth() + 1)}-${pad(cursor.getDate())}`
    days.push(key)
    if (key >= to) break
  }
  return days
}

export function buildPoints(range: RangeWindow, fieldId: string): Point[] {
  const byDate = new Map(range.days.map((day) => [day.date, day.totals]))

  return eachDay(range.from, range.to).map((date) => {
    const totals = byDate.get(date)
    return { date, value: totals && fieldId in totals ? totals[fieldId] : null }
  })
}

/**
 * Mean of logged days in a trailing window. Gaps stay in the series so the
 * trend continues through a day you skipped, rather than the line breaking
 * every time you missed a log.
 */
export function rollingMean(points: Point[], window = 7): Point[] {
  return points.map((point, index) => {
    const slice = points.slice(Math.max(0, index - window + 1), index + 1)
    const logged = slice.filter((item): item is Point & { value: number } => item.value !== null)
    if (logged.length === 0) return { date: point.date, value: null }
    const sum = logged.reduce((acc, item) => acc + item.value, 0)
    return { date: point.date, value: sum / logged.length }
  })
}

/**
 * One point per Sunday-starting week. Calories use a sum (the week is the
 * budget); everything else averages so the daily goal line still means
 * something. Unlogged days are skipped, not treated as zero.
 */
export function weeklyPoints(points: Point[], mode: 'sum' | 'average'): Point[] {
  const groups = new Map<string, number[]>()
  const order: string[] = []

  for (const point of points) {
    if (point.value === null) continue
    const week = startOfWeek(point.date)
    const bucket = groups.get(week)
    if (bucket) {
      bucket.push(point.value)
    } else {
      groups.set(week, [point.value])
      order.push(week)
    }
  }

  return order.map((week) => {
    const values = groups.get(week) ?? []
    const total = values.reduce((acc, value) => acc + value, 0)
    return { date: week, value: mode === 'sum' ? total : total / values.length }
  })
}

export function weekLoggedDays(daily: Point[], weekStart: string): number {
  const weekEnd = endOfWeek(weekStart)
  return daily.filter(
    (point) => point.date >= weekStart && point.date <= weekEnd && point.value !== null,
  ).length
}
