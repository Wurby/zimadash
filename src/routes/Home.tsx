import { Link } from 'react-router'
import { tools } from '../tools/registry'
import { usePwaManifest } from '../lib/pwa'
import { Icon } from '../components/Icon'

/**
 * The homepage is the tile grid and nothing else.
 *
 * Tiles render live data at rest — a tile should be informative before you tap
 * it, because on the wall display most of them never get tapped at all. The
 * grid goes one column on a phone and four on a wall-mounted tablet.
 */
export function Home() {
  usePwaManifest(null)

  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
      {tools.length === 0 ? (
        <div className="border-line text-ink-dim rounded-2xl border border-dashed p-10 text-center">
          <Icon name="grid" className="mx-auto mb-3 !h-8 !w-8 opacity-50" />
          <p className="text-sm">No tools yet.</p>
          <p className="mt-1 font-mono text-xs">
            drop a folder in src/tools/&lt;slug&gt;/ with a tool.tsx
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {tools.map(({ meta, Tile }) => (
            <Link
              key={meta.slug}
              to={`/${meta.slug}`}
              className="border-line bg-surface hover:border-accent focus-visible:border-accent group flex min-h-36 items-stretch overflow-hidden rounded-2xl border shadow-sm transition-colors outline-none"
            >
              {/* Title strip — the header badge's pattern: vertical text on a
                  slate band flush to the left edge, doing the job the padding
                  would otherwise do. Rotated rather than stacked upright, so it
                  takes the name's normal width along the tile's height. */}
              <h2 className="flex w-6 shrink-0 items-center justify-center bg-slate-200 dark:bg-slate-800">
                <span className="rotate-180 text-sm leading-none font-bold tracking-[0.12em] text-slate-600 [writing-mode:vertical-rl] dark:text-slate-300">
                  {meta.name}
                </span>
              </h2>

              <div className="flex min-w-0 flex-1 flex-col p-5">
                <span
                  aria-hidden="true"
                  className="text-ink-dim group-hover:text-accent self-end font-mono text-lg leading-none transition-colors"
                >
                  {meta.glyph}
                </span>
                <div className="mt-3 flex-1">
                  <Tile />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  )
}
