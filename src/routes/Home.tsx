import { useState } from 'react'
import { Link } from 'react-router'
import type { ActionSummary } from '@shared/types'
import {
  BADGE_SIZES,
  isBadge,
  itemId,
  overrideSpan,
  resolveSpan,
  sizeKey,
  type SizeBySurface,
  type Span,
} from '@shared/layout'
import { tools } from '../tools/registry'
import { api } from '../lib/api'
import { usePolled } from '../lib/refresh'
import { usePwaManifest } from '../lib/pwa'
import { useGrid, gridStyle, itemStyle } from '../lib/grid'
import { useLayout } from '../lib/layout'
import { nextTheme, useTheme } from '../lib/theme'
import { Icon } from '../components/Icon'
import { ActionButton } from '../components/QuickActions'
import { StatsTile } from '../components/StatsTile'
import { SizePicker } from '../components/SizePicker'
import { useReorder } from '../lib/reorder'

/**
 * The dashboard. One grid holding everything — tools, one-tap actions, the
 * system readout, the theme toggle — rather than a tile grid with a bar of
 * controls bolted above it.
 *
 * Sizes come from the things themselves; the order is yours. Packing is dense,
 * so a small item drops back into a hole a larger one couldn't fit and the
 * arrangement stays tight without you managing it.
 */

function ToolTile({ slug }: { slug: string }) {
  const tool = tools.find((candidate) => candidate.meta.slug === slug)
  if (!tool) return null
  const { meta, Tile, interactiveTile } = tool

  // The title strip is the tile's left padding, same as the badge. When the
  // body takes its own taps the strip is also the only way into the tool, so it
  // carries the link instead of the whole tile.
  const band = (
    <span className="rotate-180 text-sm leading-none font-bold tracking-[0.12em] text-slate-600 [writing-mode:vertical-rl] dark:text-slate-300">
      {meta.name}
    </span>
  )

  const body = (
    // The glyph is taken out of the flow rather than given a row of its own —
    // it is decoration, and a whole grid row of it was pushing the actual
    // content down and leaving a gap underneath.
    <div className="relative min-w-0 flex-1 overflow-hidden p-3">
      <span
        aria-hidden="true"
        className="text-ink-dim group-hover:text-accent pointer-events-none absolute top-2 right-2.5 font-mono text-base leading-none transition-colors"
      >
        {meta.glyph}
      </span>
      <div className="h-full overflow-hidden">
        <Tile />
      </div>
    </div>
  )

  const frame =
    'border-line bg-surface hover:border-accent focus-visible:border-accent group flex h-full items-stretch overflow-hidden border shadow-sm transition-colors outline-none'

  if (interactiveTile) {
    return (
      <div className={frame}>
        <Link
          to={`/${meta.slug}`}
          aria-label={`Configure ${meta.name}`}
          // Wider than the 24px band a normal tile gets. On those the whole
          // tile is the link, so the strip's width is decoration; here it is
          // the only way in, and 24px is half a fingertip. The cost is 20px of
          // content width, which the sole entrance is worth.
          className="hover:bg-slate-300 focus-visible:bg-slate-300 flex w-11 shrink-0 items-center justify-center bg-slate-200 transition-colors outline-none dark:bg-slate-800 dark:hover:bg-slate-700 dark:focus-visible:bg-slate-700"
        >
          {band}
        </Link>
        {body}
      </div>
    )
  }

  return (
    <Link to={`/${meta.slug}`} className={frame}>
      <h2 className="flex w-6 shrink-0 items-center justify-center bg-slate-200 dark:bg-slate-800">
        {band}
      </h2>
      {body}
    </Link>
  )
}

export function Home() {
  usePwaManifest(null)
  const [ref, geometry] = useGrid<HTMLDivElement>()
  const { theme, resolved, cycle } = useTheme()
  const [editing, setEditing] = useState(false)
  // Which badges are showing their expanded readout. A list rather than one
  // flag per badge, so a second badge needs no new state here.
  const [expanded, setExpanded] = useState<string[]>([])
  // The tile whose size picker is open, if any.
  const [sizing, setSizing] = useState<string | null>(null)

  const actions = usePolled('event-driven', () =>
    api<{ actions: ActionSummary[] }>('/api/actions').then((body) => body.actions),
  )
  const actionList = actions.status === 'ok' ? actions.data : []

  // Everything that can appear, in the order it would take if you'd never
  // rearranged anything.
  const present = [
    itemId.stats,
    ...tools.map((tool) => itemId.tool(tool.meta.slug)),
    ...actionList.map((action) => itemId.action(action.id)),
    itemId.theme,
    itemId.edit,
  ]

  const { order, sizes, reorder, resize } = useLayout(present)

  // Tools and badges have a size worth choosing. The actions and the two system
  // buttons don't — they are a single icon, and one unit is what an icon is.
  function resizable(id: string): boolean {
    return id.startsWith('tool:') || isBadge(id)
  }

  function isExpanded(id: string): boolean {
    return expanded.includes(id)
  }

  function toggleBadge(id: string) {
    setExpanded((was) => (was.includes(id) ? was.filter((open) => open !== id) : [...was, id]))
  }

  // A tap in edit mode has nowhere else to go — the drag only arms once the
  // pointer travels, and the tile's contents are inert — so it opens the size
  // picker.
  const drag = useReorder(order, reorder, editing, (id) => {
    setSizing((was) => (was === id || !resizable(id) ? null : id))
  })

  function toolFor(id: string) {
    return tools.find((candidate) => itemId.tool(candidate.meta.slug) === id)
  }

  /** The size a thing asks for, in its current form, before any override. */
  function declaredFor(id: string): SizeBySurface | undefined {
    const badge = BADGE_SIZES[id]
    if (badge) return isExpanded(id) ? badge.expanded : badge.collapsed
    return toolFor(id)?.meta.size
  }

  /** Which slot this item's chosen size lives in right now. */
  function keyFor(id: string): string {
    return sizeKey(id, isExpanded(id))
  }

  function spanOf(id: string): Span {
    if (!resizable(id)) return [1, 1]
    return resolveSpan(declaredFor(id), sizes[keyFor(id)], geometry.breakpoint)
  }

  function render(id: string) {
    if (id === itemId.stats) {
      return <StatsTile open={isExpanded(id)} onToggle={() => toggleBadge(id)} />
    }

    if (id.startsWith('tool:')) return <ToolTile slug={id.slice('tool:'.length)} />

    if (id.startsWith('action:')) {
      const action = actionList.find((candidate) => itemId.action(candidate.id) === id)
      return action ? <ActionButton action={action} /> : null
    }

    if (id === itemId.theme) {
      return (
        <button
          type="button"
          onClick={cycle}
          // The icon shows the *mode*, not what's on screen — otherwise system
          // mode is indistinguishable from whichever theme it happens to have
          // landed on. The label carries both, since that difference is the
          // whole point of the third state.
          aria-label={`Theme: ${theme}${
            theme === 'system' ? ` (currently ${resolved})` : ''
          }. Switch to ${nextTheme(theme)}.`}
          className="border-line bg-surface hover:border-accent grid h-full w-full place-items-center border transition-colors"
        >
          <Icon name={theme === 'system' ? 'system' : theme === 'dark' ? 'moon' : 'sun'} />
        </button>
      )
    }

    return (
      <button
        type="button"
        onClick={() => {
          setEditing((was) => !was)
          setSizing(null)
        }}
        aria-pressed={editing}
        aria-label={editing ? 'Finish arranging' : 'Arrange the dashboard'}
        className={`grid h-full w-full place-items-center border transition-colors ${
          editing ? 'border-accent text-accent' : 'border-line bg-surface hover:border-accent'
        }`}
      >
        <Icon name={editing ? 'check' : 'grid'} />
      </button>
    )
  }

  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
      {editing && (
        <p className="text-ink-dim mb-3 font-mono text-xs">
          drag to rearrange · tap a tile to resize · tap the tick when you're done
        </p>
      )}

      <div ref={ref} style={gridStyle(geometry)}>
        {order.map((id) => {
          // A selected badge hands its taps back. Both its forms are sizeable,
          // and the only way to reach the expanded one is to expand it — so
          // while its picker is open the badge stays live and tapping it
          // switches form, with the picker following to that form's size.
          // Deselect it (tap elsewhere, or Escape) to drag it again.
          const live = editing && id === sizing && isBadge(id)

          // The edit button is never draggable. It is the only way out of edit
          // mode, and a cell that is a drag handle has its contents made
          // untappable — which would leave you stuck in here with nothing to
          // press. It can still be moved around like anything else once you
          // are done.
          const grabbable = editing && id !== itemId.edit && !live

          return (
            <div
              key={id}
              data-item={id}
              style={itemStyle(spanOf(id), geometry)}
              {...(id === itemId.edit || live ? {} : drag.handlers(id))}
              // min-h-0 matters: a grid item defaults to min-height:auto, so any
              // tile whose contents outgrow its span quietly stretches the row
              // track and knocks every other tile off the grid. Clipping keeps
              // the declared size honest — if something doesn't fit, the tool
              // should declare a bigger span rather than bend the layout.
              className={`min-h-0 min-w-0 overflow-hidden ${
                grabbable ? 'cursor-grab touch-none select-none active:cursor-grabbing' : ''
              } ${drag.dragging === id ? 'opacity-40' : ''} ${
                sizing === id ? 'outline-accent outline-2 outline-offset-2' : ''
              }`}
            >
              {/* While a cell is a drag handle, anything inside that would
                  normally take the tap has to stop taking it. */}
              <div className={`h-full ${grabbable ? 'pointer-events-none' : ''}`}>{render(id)}</div>
            </div>
          )
        })}
      </div>

      {/* Hidden while something is being dragged — the grid is reflowing under
          the pointer, and a picker pinned to where its tile used to be is worse
          than no picker. Unmounting means it re-measures when the drag ends. */}
      {editing && sizing && !drag.dragging && (
        <SizePicker
          // Keyed on the slot, so expanding a badge remounts the picker and it
          // measures the new shape from scratch. Without that it would keep the
          // position it took against the collapsed tile whenever both forms
          // happen to carry the same override.
          key={keyFor(sizing)}
          item={sizing}
          unit={geometry.unit}
          value={overrideSpan(sizes[keyFor(sizing)], geometry.breakpoint)}
          onPick={(span) => resize(keyFor(sizing), geometry.breakpoint, span)}
          onClose={() => setSizing(null)}
        />
      )}

      {tools.length === 0 && (
        <p className="text-ink-dim mt-6 font-mono text-xs">
          drop a folder in src/tools/&lt;slug&gt;/ with a tool.tsx
        </p>
      )}
    </main>
  )
}
