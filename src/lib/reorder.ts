import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Drag to rearrange, on a packed grid, with a finger.
 *
 * Pointer events rather than HTML5 drag-and-drop, which doesn't exist on touch.
 * The dragged item is found by hit-testing the pointer against the other cells'
 * rectangles, so it doesn't matter that your finger is on top of the thing you
 * are moving — the cell underneath is what counts.
 *
 * The order updates live as you cross a boundary, so the grid reflows under
 * your finger and you can see where it will land. Each landing saves.
 */

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
    if (!id) return

    event.preventDefault()
    cell.setPointerCapture(event.pointerId)
    setDragging(id)

    const grid = cell.parentElement
    if (!grid) return

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
      const over = cellUnder(moveEvent.clientX, moveEvent.clientY)
      if (!over) return

      const { order: current, onReorder: save } = latest.current
      const from = current.indexOf(id!)
      const to = current.indexOf(over)
      if (from === -1 || to === -1 || from === to) return

      const next = [...current]
      next.splice(to, 0, ...next.splice(from, 1))
      save(next)
    }

    function up() {
      cell.releasePointerCapture(event.pointerId)
      cell.removeEventListener('pointermove', move)
      cell.removeEventListener('pointerup', up)
      cell.removeEventListener('pointercancel', up)
      setDragging(null)
    }

    cell.addEventListener('pointermove', move)
    cell.addEventListener('pointerup', up)
    cell.addEventListener('pointercancel', up)
  }, [])

  const handlers = useCallback(
    (_id: string) => (enabled ? { onPointerDown } : {}),
    [enabled, onPointerDown],
  )

  return { dragging, handlers }
}
