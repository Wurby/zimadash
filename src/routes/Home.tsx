import { useState } from 'react'
import { Link } from 'react-router'
import type { ActionSummary } from '@shared/types'
import { itemId, spanFor, type Span } from '@shared/layout'
import { tools } from '../tools/registry'
import { api } from '../lib/api'
import { usePolled } from '../lib/refresh'
import { usePwaManifest } from '../lib/pwa'
import { useGrid, gridStyle, itemStyle } from '../lib/grid'
import { useLayout } from '../lib/layout'
import { useTheme } from '../lib/theme'
import { Icon } from '../components/Icon'
import { ActionButton } from '../components/QuickActions'
import { StatsTile } from '../components/StatsTile'
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
  const { meta, Tile } = tool

  return (
    <Link
      to={`/${meta.slug}`}
      className="border-line bg-surface hover:border-accent focus-visible:border-accent group flex h-full items-stretch overflow-hidden border shadow-sm transition-colors outline-none"
    >
      {/* The title strip is the tile's left padding, same as the badge. */}
      <h2 className="flex w-6 shrink-0 items-center justify-center bg-slate-200 dark:bg-slate-800">
        <span className="rotate-180 text-sm leading-none font-bold tracking-[0.12em] text-slate-600 [writing-mode:vertical-rl] dark:text-slate-300">
          {meta.name}
        </span>
      </h2>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden p-4">
        <span
          aria-hidden="true"
          className="text-ink-dim group-hover:text-accent self-end font-mono text-lg leading-none transition-colors"
        >
          {meta.glyph}
        </span>
        <div className="mt-2 min-h-0 flex-1 overflow-hidden">
          <Tile />
        </div>
      </div>
    </Link>
  )
}

export function Home() {
  usePwaManifest(null)
  const [ref, geometry] = useGrid<HTMLDivElement>()
  const { theme, toggle } = useTheme()
  const [editing, setEditing] = useState(false)
  const [statsOpen, setStatsOpen] = useState(false)

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

  const { order, reorder } = useLayout(present)
  const drag = useReorder(order, reorder, editing)

  function spanOf(id: string): Span {
    if (id === itemId.stats) {
      // Expanding pushes the grid down rather than dropping over it, so it has
      // to actually claim the space.
      if (statsOpen) return [Math.min(geometry.columns, 8), 6]
      return geometry.breakpoint === 'sm' ? [2, 2] : [4, 4]
    }
    if (id.startsWith('tool:')) {
      const tool = tools.find((candidate) => itemId.tool(candidate.meta.slug) === id)
      return spanFor(tool?.meta.size, geometry.breakpoint)
    }
    return [1, 1]
  }

  function render(id: string) {
    if (id === itemId.stats) {
      return <StatsTile open={statsOpen} onToggle={() => setStatsOpen((was) => !was)} />
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
          onClick={toggle}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          className="border-line bg-surface hover:border-accent grid h-full w-full place-items-center border transition-colors"
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
        </button>
      )
    }

    return (
      <button
        type="button"
        onClick={() => setEditing((was) => !was)}
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
          drag to rearrange · tap the tick when you're done
        </p>
      )}

      <div ref={ref} style={gridStyle(geometry)}>
        {order.map((id) => (
          <div
            key={id}
            data-item={id}
            style={itemStyle(spanOf(id), geometry)}
            {...drag.handlers(id)}
            className={`min-w-0 ${
              editing ? 'cursor-grab touch-none select-none active:cursor-grabbing' : ''
            } ${drag.dragging === id ? 'opacity-40' : ''}`}
          >
            {/* In edit mode the whole cell is a drag handle, so anything inside
                that would normally take the tap has to stop taking it. */}
            <div className={`h-full ${editing ? 'pointer-events-none' : ''}`}>{render(id)}</div>
          </div>
        ))}
      </div>

      {tools.length === 0 && (
        <p className="text-ink-dim mt-6 font-mono text-xs">
          drop a folder in src/tools/&lt;slug&gt;/ with a tool.tsx
        </p>
      )}
    </main>
  )
}
