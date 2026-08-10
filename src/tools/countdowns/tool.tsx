import type { CountdownView } from '@shared/countdowns'
import { usePolled } from '../../lib/refresh'
import { defineTool } from '../types'
import meta from './meta.json'
import { getCountdowns } from './api'
import { Config } from './Config'

/**
 * Countdowns — what's coming, and how soon.
 *
 * The tile is a readout and the route is configuration, so this one keeps the
 * ordinary whole-tile link. Four is the cap: enough to be useful, few enough
 * that they all fit without a scroll or a "+2 more".
 *
 * `ambient` because the number changes at midnight without anything being
 * entered. A wall display left on overnight has to be showing today's count in
 * the morning, not yesterday's.
 */

/** How near reads as colour. Tool data colours are exempt from slate-and-sky,
 *  and "this week" versus "next year" has to separate at a glance. */
function toneFor(item: CountdownView): string {
  if (item.passed) return 'text-ink-dim'
  if (item.days <= 7) return 'text-danger'
  if (item.days <= 30) return 'text-amber-700 dark:text-amber-400'
  return 'text-accent'
}

function Tile() {
  const list = usePolled('ambient', getCountdowns)

  if (list.status === 'loading') return <p className="text-ink-dim text-sm">loading…</p>
  if (list.status === 'error') return <p className="text-danger text-sm">{list.message}</p>

  if (list.data.items.length === 0) {
    return <p className="text-ink-dim text-sm italic">Nothing counting down — tap to add one.</p>
  }

  return (
    <ul className="flex h-full flex-col justify-between gap-1">
      {list.data.items.map((item) => (
        <li key={item.id} className="flex min-h-0 items-baseline gap-2">
          <span className={`shrink-0 font-mono text-xl leading-none tabular-nums ${toneFor(item)}`}>
            {Math.abs(item.days)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium">{item.label}</span>
            <span className="text-ink-dim block font-mono text-[0.6rem] tracking-wide uppercase">
              {item.days === 0
                ? 'today'
                : item.passed
                  ? `day${item.days === -1 ? '' : 's'} ago`
                  : `day${item.days === 1 ? '' : 's'} away`}
            </span>
          </span>
        </li>
      ))}
    </ul>
  )
}

export default defineTool({
  meta,
  tier: 'ambient',
  Tile,
  View: Config,
})
