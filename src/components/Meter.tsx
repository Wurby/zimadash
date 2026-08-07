/**
 * A labelled bar. The number is duplicated as text beside the bar rather than
 * relying on bar length alone — this has to be readable from across a room, and
 * eventually on a display with no colour at all.
 */
export function Meter({
  label,
  percent,
  detail,
  compact = false,
}: {
  label: string
  percent: number
  detail?: string
  compact?: boolean
}) {
  const clamped = Math.min(100, Math.max(0, percent))

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-ink-dim text-xs font-medium tracking-wide uppercase">{label}</span>
        <span className="font-mono text-sm tabular-nums">{Math.round(clamped)}%</span>
      </div>
      <div className="bg-line mt-1.5 h-1.5 w-full overflow-hidden rounded-full">
        <div
          className="bg-accent h-full rounded-full transition-[width] duration-500"
          style={{ width: `${clamped}%` }}
        />
      </div>
      {detail && !compact && <p className="text-ink-dim mt-1 font-mono text-xs">{detail}</p>}
    </div>
  )
}
