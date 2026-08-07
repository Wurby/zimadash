import { useState } from 'react'
import type { Settings } from '@shared/calories'
import { RANGE_LABELS, type RangeKey } from '@shared/calories'
import { usePolled } from '../../lib/refresh'
import { getRange, tracked } from './api'
import { Chart } from './Chart'
import { buildPoints } from './points'

/**
 * One chart per tracked field, over a chosen range.
 *
 * The average is over days that actually have data, not over the whole window —
 * dividing by 30 when you logged 12 days would report a number you never ate.
 */

const RANGES: RangeKey[] = ['week', 'fortnight', 'month', 'quarter', 'half', 'year']

export function ReportsTab({ settings }: { settings: Settings | null }) {
  const [range, setRange] = useState<RangeKey>('fortnight')
  const data = usePolled('event-driven', () => getRange(range))
  const fields = tracked(settings)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {RANGES.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setRange(key)}
            aria-pressed={range === key}
            className={`border px-3 py-1.5 text-sm transition-colors ${
              range === key
                ? 'border-accent text-accent'
                : 'border-line hover:border-accent bg-surface'
            }`}
          >
            {RANGE_LABELS[key]}
          </button>
        ))}
      </div>

      {data.status === 'loading' && <p className="text-ink-dim text-sm">loading…</p>}
      {data.status === 'error' && <p className="text-danger text-sm">{data.message}</p>}

      {data.status === 'ok' &&
        fields.map((field) => {
          const points = buildPoints(data.data, field.id)
          const logged = points.filter((p) => p.value !== null)
          const average = logged.length
            ? logged.reduce((sum, p) => sum + (p.value ?? 0), 0) / logged.length
            : 0

          return (
            <section key={field.id} className="border-line bg-surface border px-4 py-3">
              <Chart
                label={field.label}
                color={field.color}
                goal={field.goal}
                unit={field.unit}
                points={points}
              />
              <dl className="border-line mt-3 flex items-baseline justify-between border-t pt-3">
                <dt className="text-ink-dim text-xs tracking-wide uppercase">
                  Average · {RANGE_LABELS[range].toLowerCase()}
                </dt>
                <dd className="font-mono text-sm tabular-nums">
                  {Math.round(average)}
                  {field.unit === 'kcal' ? '' : field.unit}
                  <span className="text-ink-dim ml-2 text-xs">over {logged.length} days</span>
                </dd>
              </dl>
            </section>
          )
        })}
    </div>
  )
}
