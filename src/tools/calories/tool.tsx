import { useState } from 'react'
import type { Settings } from '@shared/calories'
import { usePolled } from '../../lib/refresh'
import { defineTool } from '../types'
import meta from './meta.json'
import { getDay, getSettings, getWeight, tracked, withEffectiveGoal } from './api'
import { CaloriesBar } from './CaloriesBar'
import { MainTab } from './MainTab'
import { ReportsTab } from './ReportsTab'
import { LogTab } from './LogTab'
import { SettingsTab } from './SettingsTab'
import { WeightTab } from './WeightTab'
import { WeightBar } from './WeightBar'

/**
 * Calories — what you ate, and what it cost.
 *
 * Estimates come from Grok Build (`grok -p`) on the box, so this runs on a
 * subscription that already exists rather than a metered API key. That is the
 * whole reason the tool exists instead of a paid app, and it costs several
 * seconds per estimate, which the input is built around.
 */

const TABS = ['Today', 'Weight', 'Reports', 'Log', 'Settings'] as const
type Tab = (typeof TABS)[number]

function Tile() {
  const settings = usePolled('event-driven', getSettings)
  const day = usePolled('event-driven', getDay)
  const weight = usePolled('event-driven', getWeight)

  if (day.status === 'loading' || settings.status === 'loading') {
    return <p className="text-ink-dim text-sm">loading…</p>
  }
  if (day.status === 'error') return <p className="text-danger text-sm">{day.message}</p>
  if (settings.status !== 'ok') return null

  const expenditure = weight.status === 'ok' ? weight.data.expenditure : null
  const fields = withEffectiveGoal(tracked(settings.data), settings.data, expenditure)
  const showWeight = settings.data.weight.onTile && expenditure?.trendLb !== null
  // Calories always leads the tile — it is the summary, not one of the numbers,
  // so it isn't subject to the tile checkboxes the way the others are.
  const rest = fields.filter((field) => field.onTile && field.id !== 'calories')
  const latest = day.data.entries[day.data.entries.length - 1]

  return (
    <div className="flex h-full flex-col">
      <CaloriesBar totals={day.data.totals} fields={fields} compact />

      {rest.length > 0 && (
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5">
          {rest.map((field) => {
            const value = Math.round(day.data.totals[field.id] ?? 0)
            return (
              <div key={field.id} className="flex items-baseline gap-1.5">
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0"
                  style={{ background: field.color }}
                />
                <span className="text-ink-dim text-[0.6rem] tracking-wide uppercase">
                  {field.label}
                </span>
                <span className="ml-auto font-mono text-xs tabular-nums">
                  {value}
                  {field.goal ? (
                    <span className="text-ink-dim text-[0.6rem]">/{field.goal}</span>
                  ) : null}
                </span>
              </div>
            )
          })}
        </div>
      )}

      <div className="mt-2">
        {showWeight && expenditure ? (
          <WeightBar
            settings={settings.data.weight}
            expenditure={expenditure}
            startLb={weight.status === 'ok' ? (weight.data.trend[0]?.lb ?? null) : null}
          />
        ) : (
          <p className="text-ink-dim text-xs">
            {latest ? (
              <span className="line-clamp-2">{latest.description || 'quick entry'}</span>
            ) : (
              <span className="italic">Nothing logged today.</span>
            )}
          </p>
        )}
      </div>
    </div>
  )
}

function View() {
  const [tab, setTab] = useState<Tab>('Today')
  const loaded = usePolled('event-driven', getSettings)
  const [override, setOverride] = useState<Settings | null>(null)
  const settings = override ?? (loaded.status === 'ok' ? loaded.data : null)

  return (
    <div>
      <nav className="border-line flex gap-1 border-b" aria-label="Calories sections">
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setTab(name)}
            aria-current={tab === name ? 'page' : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === name
                ? 'border-accent text-accent'
                : 'hover:text-ink border-transparent text-ink-dim'
            }`}
          >
            {name}
          </button>
        ))}
      </nav>

      <div className="mt-6">
        {tab === 'Today' && <MainTab settings={settings} />}
        {tab === 'Weight' && <WeightTab settings={settings} onSaved={setOverride} />}
        {tab === 'Reports' && <ReportsTab settings={settings} />}
        {tab === 'Log' && <LogTab settings={settings} />}
        {tab === 'Settings' && <SettingsTab settings={settings} onSaved={setOverride} />}
      </div>
    </div>
  )
}

export default defineTool({
  meta,
  tier: 'event-driven',
  Tile,
  View,
})
