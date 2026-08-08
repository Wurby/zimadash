import { useEffect, useRef, useState } from 'react'
import { COLUMNS, GRID_GAP, breakpointFor, type Breakpoint } from '@shared/layout'

/**
 * The dashboard grid's geometry, measured rather than assumed.
 *
 * Column count steps by surface and the unit is derived to fill the width
 * exactly, so everything on the grid keeps its ratio to everything else — an
 * action is one unit wherever it is, and a 3x3 tile is three of those wide. The
 * unit itself grows from around 38px on a phone to nearly 60 on a wall display,
 * which is right: a screen read from across the room wants a bigger target than
 * one held in your hand.
 *
 * Rows are set to the same size as a column, so a span of [3, 3] is genuinely
 * square. That is why this measures instead of leaning on `1fr` — a fraction
 * can size a column but cannot tell a row how tall to be.
 */

export interface Geometry {
  breakpoint: Breakpoint
  columns: number
  unit: number
}

const INITIAL: Geometry = { breakpoint: 'sm', columns: COLUMNS.sm, unit: 40 }

export function useGrid<T extends HTMLElement>(): [React.RefObject<T | null>, Geometry] {
  const ref = useRef<T>(null)
  const [geometry, setGeometry] = useState<Geometry>(INITIAL)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    function measure(width: number) {
      if (width <= 0) return
      const breakpoint = breakpointFor(window.innerWidth)
      const columns = COLUMNS[breakpoint]
      const unit = (width - (columns - 1) * GRID_GAP) / columns
      setGeometry((was) =>
        was.breakpoint === breakpoint && was.columns === columns && Math.abs(was.unit - unit) < 0.5
          ? was
          : { breakpoint, columns, unit },
      )
    }

    measure(element.getBoundingClientRect().width)

    const observer = new ResizeObserver(([entry]) => measure(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return [ref, geometry]
}

/** Style for the grid container itself. */
export function gridStyle(geometry: Geometry): React.CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: `repeat(${geometry.columns}, ${geometry.unit}px)`,
    gridAutoRows: `${geometry.unit}px`,
    // Dense packing is what makes an ordered list behave like a layout: a small
    // item drops back into a hole a bigger one couldn't fit.
    gridAutoFlow: 'row dense',
    gap: `${GRID_GAP}px`,
  }
}

/** Style for one item, clamped so nothing can be wider than the grid. */
export function itemStyle(span: [number, number], geometry: Geometry): React.CSSProperties {
  return {
    gridColumn: `span ${Math.min(span[0], geometry.columns)}`,
    gridRow: `span ${Math.max(1, span[1])}`,
  }
}
