const pad = (n: number): string => String(n).padStart(2, '0')

/** Local-time value a `datetime-local` input wants. No timezone math — the
 *  input's value already means "local time", same as `Date`'s getters. */
export function toLocalDateTime(at: number): string {
  const d = new Date(at)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fromLocalDateTime(value: string): number {
  return new Date(value).getTime()
}

export function toLocalTime(at: number): string {
  const d = new Date(at)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Keep the day, change the clock — for editors that only ever look at today. */
export function withLocalTime(at: number, time: string): number {
  const [h, m] = time.split(':').map(Number)
  const d = new Date(at)
  d.setHours(h, m, 0, 0)
  return d.getTime()
}
