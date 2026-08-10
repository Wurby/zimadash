import { useState } from 'react'
import {
  MAX_COUNTDOWNS,
  MAX_LABEL,
  formatDay,
  humanDays,
  type CountdownView,
} from '@shared/countdowns'
import { usePolled } from '../../lib/refresh'
import {
  addCountdown,
  deleteCountdown,
  getCountdowns,
  patchCountdown,
  type CountdownPatch,
} from './api'

/**
 * The route behind the tile: configuration only. The tile does the showing;
 * this is where the four countdowns are set up.
 */

function Row({
  item,
  onPatch,
  onDelete,
}: {
  item: CountdownView
  onPatch: (patch: CountdownPatch) => Promise<void>
  onDelete: () => Promise<void>
}) {
  const [label, setLabel] = useState(item.label)
  const [confirming, setConfirming] = useState(false)

  return (
    <li className="border-line bg-surface border p-3">
      <div className="flex items-center gap-2">
        <input
          value={label}
          maxLength={MAX_LABEL}
          onChange={(event) => setLabel(event.target.value)}
          onBlur={() => {
            const trimmed = label.trim()
            if (!trimmed) {
              setLabel(item.label)
              return
            }
            if (trimmed !== item.label) void onPatch({ label: trimmed })
          }}
          aria-label="Name"
          className="border-line focus:border-accent min-w-0 flex-1 border-b bg-transparent py-1 text-sm font-medium outline-none"
        />

        {confirming ? (
          <button
            type="button"
            onClick={() => void onDelete()}
            className="border-danger text-danger hover:bg-danger/10 shrink-0 border px-2 py-1 text-xs transition-colors"
          >
            really?
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            onBlur={() => setConfirming(false)}
            aria-label={`Delete ${item.label}`}
            className="border-line text-ink-dim hover:border-danger hover:text-danger shrink-0 border px-2 py-1 text-xs transition-colors"
          >
            ✕
          </button>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        <input
          type="date"
          defaultValue={item.date}
          onChange={(event) => {
            if (event.target.value && event.target.value !== item.date) {
              void onPatch({ date: event.target.value })
            }
          }}
          aria-label="Date"
          className="border-line focus:border-accent border bg-transparent px-2 py-1 font-mono text-xs outline-none"
        />

        <label className="text-ink-dim flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={item.yearly}
            onChange={(event) => void onPatch({ yearly: event.target.checked })}
            className="accent-accent"
          />
          every year
        </label>

        <span className="text-ink-dim font-mono text-xs">
          {humanDays(item.days)}
          {item.yearly && item.target !== item.date ? ` · next ${item.target}` : ''}
        </span>
      </div>

      {item.passed && !item.yearly && (
        <p className="text-ink-dim mt-2 text-xs italic">
          This one has been and gone. It stays until you delete it — tick "every year" if it should
          come round again instead.
        </p>
      )}
    </li>
  )
}

export function Config() {
  const list = usePolled('event-driven', getCountdowns)
  const [label, setLabel] = useState('')
  const [date, setDate] = useState(() => formatDay(new Date()))
  const [yearly, setYearly] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const items: CountdownView[] = list.status === 'ok' ? list.data.items : []
  const full = items.length >= MAX_COUNTDOWNS

  async function run(work: () => Promise<unknown>) {
    setError(null)
    try {
      await work()
      list.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'that did not work')
    }
  }

  async function create(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = label.trim()
    if (!trimmed) return

    setSaving(true)
    await run(async () => {
      await addCountdown(trimmed, date, yearly)
      setLabel('')
      setYearly(false)
    })
    setSaving(false)
  }

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-sm font-semibold tracking-tight">Add a countdown</h2>
        <p className="text-ink-dim mt-1 text-xs">
          Four at a time. A one-off keeps counting after it passes until you delete it; a yearly one
          rolls straight on to next year.
        </p>

        <form onSubmit={create} className="mt-3 flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1">
            <span className="text-ink-dim text-xs">Name</span>
            <input
              value={label}
              maxLength={MAX_LABEL}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Shoot day"
              disabled={full}
              className="border-line focus:border-accent mt-1 w-full border bg-transparent px-2 py-1.5 text-sm outline-none disabled:opacity-40"
            />
          </label>

          <label>
            <span className="text-ink-dim text-xs">Date</span>
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              disabled={full}
              className="border-line focus:border-accent mt-1 border bg-transparent px-2 py-1.5 font-mono text-sm outline-none disabled:opacity-40"
            />
          </label>

          <label className="text-ink-dim flex items-center gap-1.5 py-2 text-xs">
            <input
              type="checkbox"
              checked={yearly}
              onChange={(event) => setYearly(event.target.checked)}
              disabled={full}
              className="accent-accent"
            />
            every year
          </label>

          <button
            type="submit"
            disabled={saving || full || !label.trim()}
            className="border-accent text-accent hover:bg-accent/10 border px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? 'adding…' : 'add'}
          </button>
        </form>

        {full && (
          <p className="text-ink-dim mt-2 text-xs">
            That's all {MAX_COUNTDOWNS}. Delete one to make room.
          </p>
        )}
        {error && <p className="text-danger mt-2 text-xs">{error}</p>}
      </section>

      <section>
        <h2 className="text-sm font-semibold tracking-tight">Counting down</h2>

        {list.status === 'loading' && <p className="text-ink-dim mt-3 text-sm">loading…</p>}
        {list.status === 'error' && <p className="text-danger mt-3 text-sm">{list.message}</p>}

        {list.status === 'ok' && items.length === 0 && (
          <p className="text-ink-dim mt-3 text-sm italic">Nothing yet. Add the first one above.</p>
        )}

        <ul className="mt-3 space-y-2">
          {items.map((item) => (
            <Row
              key={item.id}
              item={item}
              onPatch={(patch) => run(() => patchCountdown(item.id, patch))}
              onDelete={() => run(() => deleteCountdown(item.id))}
            />
          ))}
        </ul>
      </section>
    </div>
  )
}
