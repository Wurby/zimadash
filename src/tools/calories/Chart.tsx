import { useState } from 'react'

/**
 * Daily totals for one field.
 *
 * One chart per field rather than all of them together: calories run to
 * thousands and fibre to tens, and putting those on one plot needs two y-scales
 * — which is the single worst thing you can do to a chart. Separate plots, each
 * with its own scale, and nothing to misread.
 *
 * A single series means the title carries identity, so there is no legend and
 * colour is never the only thing distinguishing anything.
 *
 * Missing days are genuine gaps in the line, not zeros. A day you didn't log is
 * unknown, and drawing it as zero would invent a fast you didn't do.
 */

export interface Point {
  date: string
  value: number | null
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

export function Chart({
  points,
  color,
  goal,
  unit,
  label,
}: {
  points: Point[]
  color: string
  goal: number | null
  unit: string
  label: string
}) {
  const [hover, setHover] = useState<number | null>(null)

  const values = points.map((p) => p.value).filter((v): v is number => v !== null)
  if (values.length === 0) {
    return <p className="text-ink-dim py-6 text-center text-sm">Nothing logged in this range.</p>
  }

  const top = niceCeiling(Math.max(...values, goal ?? 0))
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom

  const x = (i: number) =>
    PAD.left + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW)
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH

  // Break the path wherever a day has no data, so the line stops rather than
  // sloping through a day that never happened.
  const path = points
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

  const active = hover !== null ? points[hover] : null

  function locate(event: React.PointerEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect()
    const ratio = (event.clientX - box.left) / box.width
    const i = Math.round(((ratio * W - PAD.left) / plotW) * (points.length - 1))
    setHover(Math.min(points.length - 1, Math.max(0, i)))
  }

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          {/* The swatch sits beside the name, never instead of it. */}
          <span aria-hidden="true" className="size-2.5 shrink-0" style={{ background: color }} />
          {label}
        </h3>
        <span className="text-ink-dim font-mono text-xs tabular-nums">
          {active?.value != null
            ? `${shortDate(active.date)} · ${Math.round(active.value)}${unit === 'kcal' ? '' : unit}`
            : `peak ${Math.round(Math.max(...values))}${unit === 'kcal' ? '' : unit}`}
        </span>
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

        {goal !== null && goal > 0 && goal <= top && (
          <>
            <line
              x1={PAD.left}
              y1={y(goal)}
              x2={W - PAD.right}
              y2={y(goal)}
              className="stroke-ink-dim"
              strokeWidth="1"
              strokeDasharray="5 4"
            />
            <text
              x={W - PAD.right}
              y={y(goal) - 4}
              textAnchor="end"
              className="fill-ink-dim text-[17px]"
            >
              goal {goal}
            </text>
          </>
        )}

        <path
          d={path}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Dots only when the range is short enough for them to mean anything. */}
        {points.length <= 31 &&
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
