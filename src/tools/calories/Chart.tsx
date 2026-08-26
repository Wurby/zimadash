import { useState } from 'react'
import type { Point } from './points'

export type { Point }

/**
 * Daily totals for one field.
 *
 * One chart per field rather than all of them together: calories run to
 * thousands and fibre to tens, and putting those on one plot needs two y-scales
 * — which is the single worst thing you can do to a chart. Separate plots, each
 * with its own scale, and nothing to misread.
 *
 * A single series means the title carries identity, so there is no legend and
 * colour is never the only thing distinguishing anything. A rolling mean is the
 * same quantity smoothed, not a second field, so it may share the scale.
 *
 * Missing days are genuine gaps in the line, not zeros. A day you didn't log is
 * unknown, and drawing it as zero would invent a fast you didn't do.
 */

export interface Marker {
  value: number
  label: string
}

export interface StackSegment {
  color: string
  share: number
}

// Text inside an SVG scales with the viewBox, so a 640-wide box rendered at
// ~360px on a phone shrinks a "10px" label to about 5.6px — which is why the
// axis labels were unreadable. Sizes here are viewBox units, deliberately large.
const W = 640
const H = 168
const PAD = { top: 16, right: 10, bottom: 28, left: 52 }

const niceCeiling = (value: number): number => {
  if (value <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  return Math.ceil(value / magnitude) * magnitude
}

const shortDate = (date: string): string => date.slice(5).replace('-', '/')

function linePath(points: Point[], x: (i: number) => number, y: (v: number) => number): string {
  return points
    .map((p, i) => (p.value === null ? null : `${x(i)},${y(p.value)}`))
    .reduce<string[]>(
      (segments, coord) => {
        if (coord === null) return [...segments, '']
        const last = segments[segments.length - 1] ?? ''
        return [...segments.slice(0, -1), last ? `${last} L${coord}` : `M${coord}`]
      },
      [''],
    )
    .filter(Boolean)
    .join(' ')
}

export function Chart({
  points,
  color,
  goal,
  unit,
  label,
  trend,
  markers,
  mode = 'line',
  stacks,
  faint,
  onOpen,
}: {
  points: Point[]
  color: string
  goal: number | null
  unit: string
  label: string
  /** Same-scale rolling mean. Drawn through gaps so a missed day doesn't break it. */
  trend?: Point[]
  markers?: Marker[]
  mode?: 'line' | 'bar'
  /** Per-day macro shares, aligned with `points`. Empty segments mean a bare number. */
  stacks?: Array<StackSegment[] | null>
  /** Dim a bar (incomplete weeks). Aligned with `points`. */
  faint?: boolean[]
  onOpen?: (date: string) => void
}) {
  const [hover, setHover] = useState<number | null>(null)

  const values = points.map((p) => p.value).filter((v): v is number => v !== null)
  if (values.length === 0) {
    return <p className="text-ink-dim py-6 text-center text-sm">Nothing logged in this range.</p>
  }

  const extra = (markers ?? []).map((marker) => marker.value)
  const top = niceCeiling(Math.max(...values, goal ?? 0, ...extra))
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const barW = (plotW / points.length) * 0.72

  const x = (i: number) => {
    if (points.length === 1) return PAD.left + plotW / 2
    if (mode === 'bar') return PAD.left + ((i + 0.5) / points.length) * plotW
    return PAD.left + (i / (points.length - 1)) * plotW
  }
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH

  const path = linePath(points, x, y)
  const trendPath = trend ? linePath(trend, x, y) : ''
  const active = hover !== null ? points[hover] : null
  const lines: Marker[] = [
    ...(goal !== null && goal > 0 ? [{ value: goal, label: `goal ${Math.round(goal)}` }] : []),
    ...(markers ?? []),
  ].filter((line) => line.value > 0 && line.value <= top)

  function locate(event: React.PointerEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect()
    const ratio = (event.clientX - box.left) / box.width
    const along = (ratio * W - PAD.left) / plotW
    const i =
      mode === 'bar' ? Math.floor(along * points.length) : Math.round(along * (points.length - 1))
    setHover(Math.min(points.length - 1, Math.max(0, i)))
  }

  const unitSuffix = unit === 'kcal' ? '' : unit
  const readout =
    active?.value != null
      ? `${shortDate(active.date)} · ${Math.round(active.value)}${unitSuffix}`
      : `peak ${Math.round(Math.max(...values))}${unitSuffix}`

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          {/* The swatch sits beside the name, never instead of it. */}
          <span aria-hidden="true" className="size-2.5 shrink-0" style={{ background: color }} />
          {label}
        </h3>
        {onOpen && active ? (
          <button
            type="button"
            onClick={() => onOpen(active.date)}
            className="text-ink-dim hover:text-accent min-h-11 font-mono text-xs tabular-nums"
          >
            {readout} · log
          </button>
        ) : (
          <span className="text-ink-dim font-mono text-xs tabular-nums">{readout}</span>
        )}
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-2 w-full touch-pan-y"
        role="img"
        aria-label={`${label} per day`}
        // pointermove alone means a touch has to be held and dragged before
        // anything appears, because a tap never produces one. pointerdown makes
        // a single tap — or a single click — land the crosshair straight away.
        onPointerDown={locate}
        // Then follow the finger or the mouse: buttons > 0 catches a touch drag,
        // where a plain hover doesn't exist.
        onPointerMove={(event) => {
          if (event.pointerType === 'mouse' || event.buttons > 0) locate(event)
        }}
        // Only a mouse "leaves". Clearing on touch would wipe the crosshair the
        // instant you lifted your finger, which is exactly when you want to read it.
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse') setHover(null)
        }}
      >
        {/* Recessive frame: a baseline and a top rule, nothing more. */}
        <line
          x1={PAD.left}
          y1={y(0)}
          x2={W - PAD.right}
          y2={y(0)}
          className="stroke-line"
          strokeWidth="1"
        />
        <line
          x1={PAD.left}
          y1={PAD.top}
          x2={W - PAD.right}
          y2={PAD.top}
          className="stroke-line"
          strokeWidth="1"
          strokeDasharray="2 4"
        />
        <text
          x={PAD.left - 6}
          y={PAD.top + 4}
          textAnchor="end"
          className="fill-ink-dim text-[17px]"
        >
          {top}
        </text>
        <text x={PAD.left - 6} y={y(0)} textAnchor="end" className="fill-ink-dim text-[17px]">
          0
        </text>

        {lines.map((line, index) => (
          <g key={line.label}>
            <line
              x1={PAD.left}
              y1={y(line.value)}
              x2={W - PAD.right}
              y2={y(line.value)}
              className="stroke-ink-dim"
              strokeWidth="1"
              strokeDasharray="5 4"
            />
            <text
              x={W - PAD.right}
              y={
                y(line.value) -
                4 +
                (index > 0 && Math.abs(y(line.value) - y(lines[0]!.value)) < 18 ? 16 : 0)
              }
              textAnchor="end"
              className="fill-ink-dim text-[17px]"
            >
              {line.label}
            </text>
          </g>
        ))}

        {mode === 'bar' &&
          points.map((p, i) => {
            if (p.value === null) return null
            const x0 = x(i) - barW / 2
            const topY = y(p.value)
            const height = Math.max(0, y(0) - topY)
            const opacity = faint?.[i] ? 0.45 : 1
            const segments = stacks?.[i]
            if (!segments || segments.length === 0) {
              return (
                <rect
                  key={p.date}
                  x={x0}
                  y={topY}
                  width={barW}
                  height={height}
                  fill={segments ? undefined : color}
                  className={segments ? 'fill-ink-dim' : undefined}
                  opacity={opacity}
                />
              )
            }
            let acc = 0
            return (
              <g key={p.date} opacity={opacity}>
                {segments.map((segment, s) => {
                  const h = height * segment.share
                  const ySeg = y(0) - acc - h
                  acc += h
                  return (
                    <rect
                      key={`${p.date}-${s}`}
                      x={x0}
                      y={ySeg}
                      width={barW}
                      height={h}
                      fill={segment.color}
                    />
                  )
                })}
              </g>
            )
          })}

        {mode === 'line' && (
          <path
            d={path}
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}

        {trendPath && (
          <path
            d={trendPath}
            fill="none"
            className="stroke-ink"
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity="0.45"
          />
        )}

        {/* Dots only when the range is short enough for them to mean anything. */}
        {mode === 'line' &&
          points.length <= 31 &&
          points.map((p, i) =>
            p.value === null ? null : (
              <circle key={p.date} cx={x(i)} cy={y(p.value)} r={hover === i ? 5 : 3} fill={color} />
            ),
          )}

        {active && (
          <line
            x1={x(hover!)}
            y1={PAD.top}
            x2={x(hover!)}
            y2={y(0)}
            className="stroke-ink-dim"
            strokeWidth="1"
          />
        )}

        <text x={PAD.left} y={H - 4} className="fill-ink-dim text-[17px]">
          {shortDate(points[0].date)}
        </text>
        <text x={W - PAD.right} y={H - 4} textAnchor="end" className="fill-ink-dim text-[17px]">
          {shortDate(points[points.length - 1].date)}
        </text>
      </svg>
    </div>
  )
}
