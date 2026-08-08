import { Link, useParams } from 'react-router'
import { findTool } from '../tools/registry'
import { usePwaManifest } from '../lib/pwa'
import { Icon } from '../components/Icon'
import { NotFound } from './NotFound'

/**
 * The frame around every tool: a back arrow and a title, then the tool.
 *
 * There is no global header any more, so this bar is the only way out — which
 * means it has to stay put. A tool's Reports or Log runs well past a screen,
 * and an arrow that scrolls off the top strands you at the bottom of a long
 * page with nothing to press.
 *
 * It sticks below `--safe-top` rather than at 0. Sticky positions against the
 * viewport, so on a notched phone `top: 0` would park it under the island — the
 * page's own padding doesn't help once an element has left the flow.
 */
export function ToolShell() {
  const { slug } = useParams()
  const tool = findTool(slug)

  usePwaManifest(tool?.meta.slug ?? null, tool?.meta.shortName, tool?.meta.themeColor)

  if (!tool) return <NotFound />

  const { meta, View } = tool

  return (
    <main className="mx-auto max-w-6xl px-4 pb-8 sm:px-6 lg:px-8">
      <div className="bg-bg/85 sticky top-[var(--safe-top)] z-30 -mx-4 flex items-center gap-3 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <Link
          to="/"
          aria-label="Back to the dashboard"
          className="border-line bg-surface hover:border-accent grid size-10 shrink-0 place-items-center border transition-colors"
        >
          <Icon name="back" />
        </Link>
        <h1 className="truncate text-xl font-semibold tracking-tight">{meta.name}</h1>
      </div>

      <div className="mt-4">
        <View />
      </div>
    </main>
  )
}
