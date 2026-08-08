import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Drag to rearrange, on a packed grid, with a finger.
 *
 * Pointer events rather than HTML5 drag-and-drop, which doesn't exist on touch.
 * The dragged item is found by hit-testing the pointer against the other cells'
 * rectangles, so it doesn't matter that your finger covers the thing you are
 * moving — the cell underneath is what counts.
 *
 * Two things stop it fighting itself:
 *
 * A swap reflows the grid instantly, which puts the displaced item directly
 * under the pointer — and swapping again on the very next move would put it
 * straight back. That oscillation reads as "this item won't go past that one".
 * So after a swap the same target is ignored until the pointer reaches a
 * different cell.
 *
 * And a drag only begins once the pointer has actually travelled, so a tap is
 * still a tap. Without that, every press on a cell became a drag.
 */

/** Pointer travel before a press counts as a drag rather than a tap. */
const THRESHOLD = 6

export interface Reorder {
  dragging: string | null
  handlers: (id: string) => {
    onPointerDown?: (event: React.PointerEvent<HTMLElement>) => void
  }
}

export function useReorder(
  order: string[],
  onReorder: (next: string[]) => void,
  enabled: boolean,
): Reorder {
  const [dragging, setDragging] = useState<string | null>(null)

  // Live values for the pointer handlers, which are bound once per drag and
  // would otherwise close over the order as it was when the drag started.
  const latest = useRef({ order, onReorder })
  useEffect(() => {
    latest.current = { order, onReorder }
  })

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const cell = event.currentTarget
    const id = cell.dataset.item
    const grid = cell.parentElement
    if (!id || !grid) return

    const startX = event.clientX
    const startY = event.clientY
    let active = false
    let lastTarget: string | null = null

    function cellUnder(x: number, y: number): string | null {
      for (const candidate of grid!.children) {
        const other = candidate as HTMLElement
        if (other.dataset.item === undefined || other.dataset.item === id) continue
        const box = other.getBoundingClientRect()
        if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) {
          return other.dataset.item
        }
      }
      return null
    }

    function move(moveEvent: PointerEvent) {
      if (!active) {
        if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < THRESHOLD) return
        active = true
        setDragging(id!)
      }

      const over = cellUnder(moveEvent.clientX, moveEvent.clientY)
      // Nothing under the pointer, or still over the item we just displaced.
      if (!over || over === lastTarget) return

      const { order: current, onReorder: save } = latest.current
      const from = current.indexOf(id!)
      const to = current.indexOf(over)
      if (from === -1 || to === -1 || from === to) return

      const next = [...current]
      next.splice(to, 0, ...next.splice(from, 1))
      lastTarget = over
      save(next)
    }

    function up() {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      setDragging(null)
    }

    // On window rather than the cell: the pointer leaves the cell almost
    // immediately once the grid reflows underneath it.
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }, [])

  const handlers = useCallback(
    (_id: string) => (enabled ? { onPointerDown } : {}),
    [enabled, onPointerDown],
  )

  return { dragging, handlers }
}
