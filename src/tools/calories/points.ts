import type { RangeData } from './api'

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

function eachDay(from: string, to: string): string[] {
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

export function buildPoints(
  range: RangeData,
  fieldId: string,
): Array<{ date: string; value: number | null }> {
  const byDate = new Map(range.days.map((day) => [day.date, day.totals]))

  return eachDay(range.from, range.to).map((date) => {
    const totals = byDate.get(date)
    return { date, value: totals && fieldId in totals ? totals[fieldId] : null }
  })
}
