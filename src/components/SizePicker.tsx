import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { GRID_GAP, SIZE_OPTIONS, type Span } from '@shared/layout'

/**
 * Pick a tile's size, in edit mode, from the tile itself.
 *
 * The chips are one grid unit each — the same size as a quick action — so the
 * picker is built out of the dashboard's own measurements rather than its own
 * set of numbers. Four across and two down puts all seven sizes plus a reset in
 * a block two units tall, which is short enough to sit beside anything from a
 * 3x3 upwards.
 *
 * **Placement.** Beside the tile when the block is no taller than the tile is,
 * so it never hangs over the tile's neighbours; below it otherwise. Left
 * instead of right when the right edge is out of room, above instead of below
 * when the bottom is. It is measured, not assumed, and re-measured after every
 * pick — resizing a tile on a densely packed grid moves the tile.
 */

const COLUMNS = 4
const ROWS = 2
const PADDING = 4
const BORDER = 1
/** How close the picker may come to the edge of the screen. */
const MARGIN = 8

interface Position {
  left: number
  top: number
}

function block(unit: number): { width: number; height: number } {
  const chrome = 2 * (PADDING + BORDER)
  return {
    width: COLUMNS * unit + (COLUMNS - 1) * GRID_GAP + chrome,
    height: ROWS * unit + (ROWS - 1) * GRID_GAP + chrome,
  }
}

function place(anchor: DOMRect, width: number, height: number): Position {
  const vw = window.innerWidth
  const vh = window.innerHeight

  // A picker taller than the tile would cover whatever is stacked beside it, so
  // it only earns the side when it genuinely fits there. The extra pixel
  // absorbs the fractional heights a measured unit produces.
  if (height <= anchor.height + 1) {
    if (anchor.right + GRID_GAP + width + MARGIN <= vw) {
      return { left: anchor.right + GRID_GAP, top: anchor.top }
    }
    if (anchor.left - GRID_GAP - width >= MARGIN) {
      return { left: anchor.left - GRID_GAP - width, top: anchor.top }
    }
  }

  const below = anchor.bottom + GRID_GAP
  return {
    left: Math.max(MARGIN, Math.min(anchor.left, vw - width - MARGIN)),
    top: below + height + MARGIN <= vh ? below : Math.max(MARGIN, anchor.top - GRID_GAP - height),
  }
}

function label(span: Span): string {
  return `${span[0]}×${span[1]}`
}

export function SizePicker({
  item,
  unit,
  value,
  declared,
  onPick,
  onClose,
}: {
  /** The `data-item` id of the tile being sized. */
  item: string
  /** One grid unit, in pixels, on this surface. */
  unit: number
  /** The chosen size for this surface, or null while the tool's own stands. */
  value: Span | null
  /** What the tool asked for here — what reset goes back to. */
  declared: Span
  onPick: (span: Span | null) => void
  onClose: () => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const { width, height } = block(unit)

  // Written straight onto the element rather than held in state. Where this
  // lands is a fact about the rendered DOM, not something React can derive, and
  // routing a measurement back through state to place the thing that was
  // measured is the cascading render that pattern is warned about.
  const measure = useCallback(() => {
    const element = box.current
    if (!element) return

    const anchor = document.querySelector(`[data-item="${CSS.escape(item)}"]`)
    // The tile can go away underneath us — a tool uninstalled, a poll dropping
    // an action — and a picker for something that isn't there has no anchor.
    if (!anchor) {
      onClose()
      return
    }

    const { left, top } = place(anchor.getBoundingClientRect(), width, height)
    element.style.left = `${left}px`
    element.style.top = `${top}px`
    element.style.visibility = 'visible'
  }, [item, width, height, onClose])

  // Layout rather than plain effect: this runs after the DOM is updated but
  // before paint, so the picker is never briefly drawn in the wrong place —
  // including after a pick reflows the grid and moves the tile it hangs off.
  useLayoutEffect(measure, [measure, value?.[0], value?.[1]])

  useEffect(() => {
    window.addEventListener('resize', measure)
    // Capture, because the page scroller may not be window itself.
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [measure])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    function onDown(event: PointerEvent) {
      const target = event.target as HTMLElement | null
      // Presses inside the picker are picks. Presses on a grid cell belong to
      // that cell's own tap handler, which selects it or deselects this one —
      // closing here as well would fight it and reopen what was just closed.
      if (target?.closest('[data-size-picker]') || target?.closest('[data-item]')) return
      onClose()
    }

    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown)
    }
  }, [onClose])

  return (
    <div
      ref={box}
      data-size-picker=""
      role="group"
      aria-label="Tile size"
      className="border-accent bg-surface fixed z-20 border shadow-lg"
      style={{
        // Hidden until measured, so the first paint is never at the origin.
        // The layout effect runs before that paint, so this is not a flash you
        // can see — it is only the state the element is born in.
        visibility: 'hidden',
        left: 0,
        top: 0,
        padding: PADDING,
        display: 'grid',
        gridTemplateColumns: `repeat(${COLUMNS}, ${unit}px)`,
        gridAutoRows: `${unit}px`,
        gap: GRID_GAP,
      }}
    >
      {SIZE_OPTIONS.map((span) => {
        const active = value?.[0] === span[0] && value?.[1] === span[1]
        return (
          <button
            key={label(span)}
            type="button"
            onClick={() => onPick(span)}
            aria-pressed={active}
            className={`border font-mono text-[0.65rem] leading-none tabular-nums transition-colors ${
              active
                ? 'border-accent text-accent font-bold'
                : 'border-line text-ink-dim hover:border-accent hover:text-ink'
            }`}
          >
            {label(span)}
          </button>
        )
      })}

      <button
        type="button"
        onClick={() => onPick(null)}
        aria-pressed={value === null}
        aria-label={`Default size (${label(declared)})`}
        title={`Default (${label(declared)})`}
        className={`border text-sm leading-none transition-colors ${
          value === null
            ? 'border-accent text-accent font-bold'
            : 'border-line text-ink-dim hover:border-accent hover:text-ink'
        }`}
      >
        {'↺'}
      </button>
    </div>
  )
}
