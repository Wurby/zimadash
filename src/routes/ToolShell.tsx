import { Link, useParams } from 'react-router'
import { findTool } from '../tools/registry'
import { usePwaManifest } from '../lib/pwa'
import { Icon } from '../components/Icon'
import { NotFound } from './NotFound'

/**
 * The frame around every tool: a back arrow and a title, then the tool.
 *
 * There is no global header, so this is the only way out — a tool installed as
 * its own PWA still needs one. It scrolls with the page by choice: pinning it
 * was tried and read as chrome creeping back in, and the arrow is where you
 * expect it when you arrive.
 */
export function ToolShell() {
  const { slug } = useParams()
  const tool = findTool(slug)

  usePwaManifest(tool?.meta.slug ?? null, tool?.meta.shortName, tool?.meta.themeColor)

  if (!tool) return <NotFound />

  const { meta, View } = tool

  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
      <div className="flex items-center gap-3">
        <Link
          to="/"
          aria-label="Back to the dashboard"
          className="border-line hover:border-accent border p-1.5 transition-colors"
        >
          <Icon name="back" />
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">{meta.name}</h1>
      </div>

      <div className="mt-6">
        <View />
      </div>
    </main>
  )
}
