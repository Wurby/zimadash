import { useState } from 'react'
import {
  DEFAULT_INTERVAL_DAYS,
  MAX_ITEMS,
  MAX_LABEL,
  humanInterval,
  humanLast,
  type IntervalSource,
  type ItemView,
} from '@shared/lasttime'
import { usePolled } from '../../lib/refresh'
import { addItem, deleteItem, getItems, patchItem, type ItemPatch } from './api'

/**
 * The route behind the tile: configuration only.
 *
 * Logging happens on the grid, so nothing in here records anything — this is
 * where you say what exists, how often it's due, and what earns a place on the
 * tile.
 *
 * **Controls are sized for a finger, not a mouse.** Both surfaces this runs on
 * are touch — the phone and the wall tablet — so a desktop pointer is the odd
 * one out and doesn't get to set the sizes. `TOUCH` is the 44px floor; a bare
 * checkbox is 13px and a text-sized button about 34, which is why they carry it
 * explicitly rather than inheriting from the type.
 */

/** Minimum comfortable touch target. */
const TOUCH = 'min-h-11'

const SOURCE_NOTE: Record<IntervalSource, string> = {
  override: 'pinned by you',
  learned: 'learned from your history',
  default: 'the default you set',
}

function Row({
  item,
  onPatch,
  onDelete,
}: {
  item: ItemView
  onPatch: (patch: ItemPatch) => Promise<void>
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
          className={`border-line focus:border-accent ${TOUCH} min-w-0 flex-1 border-b bg-transparent py-1 text-sm font-medium outline-none`}
        />

        <label
          className={`text-ink-dim ${TOUCH} flex shrink-0 cursor-pointer items-center gap-1.5 px-1 text-xs`}
        >
          <input
            type="checkbox"
            checked={item.onTile}
            onChange={(event) => void onPatch({ onTile: event.target.checked })}
            className="accent-accent size-5"
          />
          on tile
        </label>

        {confirming ? (
          <button
            type="button"
            onClick={() => void onDelete()}
            className={`border-danger text-danger hover:bg-danger/10 ${TOUCH} shrink-0 border px-3 text-xs transition-colors`}
          >
            really?
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            onBlur={() => setConfirming(false)}
            aria-label={`Delete ${item.label}`}
            className={`border-line text-ink-dim hover:border-danger hover:text-danger ${TOUCH} w-11 shrink-0 border text-xs transition-colors`}
          >
            ✕
          </button>
        )}
      </div>

      {/* Each fact is kept whole, so a narrow screen breaks between them rather
          than orphaning the "tap" off its count. */}
      <p className="text-ink-dim mt-2 font-mono text-xs">
        <span className="whitespace-nowrap">{humanInterval(item.intervalDays)}</span> —{' '}
        <span className="whitespace-nowrap">{SOURCE_NOTE[item.source]}</span> ·{' '}
        <span className="whitespace-nowrap">{humanLast(item.elapsedDays)}</span> ·{' '}
        <span className="whitespace-nowrap">
          {item.taps} {item.taps === 1 ? 'tap' : 'taps'}
        </span>
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="text-ink-dim flex items-center gap-2 text-xs">
          default every
          <input
            type="number"
            min={1}
            max={3650}
            defaultValue={item.defaultDays}
            onBlur={(event) => {
              const days = Number(event.target.value)
              if (Number.isFinite(days) && days > 0 && days !== item.defaultDays) {
                void onPatch({ defaultDays: days })
              }
            }}
            // Wide enough for four characters at the 16px this becomes on a
            // touch screen, not at the 12px it looks like on a desktop.
            className={`border-line focus:border-accent ${TOUCH} w-20 border bg-transparent px-2 text-center font-mono text-xs outline-none`}
          />
          days
        </label>

        {item.overrideDays === null ? (
          <button
            type="button"
            onClick={() => void onPatch({ overrideDays: item.intervalDays })}
            disabled={item.source === 'default'}
            title={
              item.source === 'default'
                ? 'Nothing to pin yet — the default is already what it uses'
                : 'Hold this interval instead of letting it keep learning'
            }
            className={`border-line hover:border-accent hover:text-accent ${TOUCH} border px-3 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40`}
          >
            pin {humanInterval(item.intervalDays).replace('every ', '')}
          </button>
        ) : (
          <span className="flex items-center gap-2">
            <label className="text-ink-dim flex items-center gap-2 text-xs">
              pinned to
              <input
                type="number"
                min={1}
                max={3650}
                defaultValue={item.overrideDays}
                onBlur={(event) => {
                  const days = Number(event.target.value)
                  if (Number.isFinite(days) && days > 0 && days !== item.overrideDays) {
                    void onPatch({ overrideDays: days })
                  }
                }}
                className={`border-line focus:border-accent ${TOUCH} w-20 border bg-transparent px-2 text-center font-mono text-xs outline-none`}
              />
              days
            </label>
            <button
              type="button"
              onClick={() => void onPatch({ overrideDays: null })}
              className={`border-line hover:border-accent hover:text-accent ${TOUCH} border px-3 text-xs transition-colors`}
            >
              unpin
            </button>
          </span>
        )}
      </div>

      {item.learnedDays !== null && item.source !== 'learned' && (
        <p className="text-ink-dim mt-2 text-xs italic">
          Your history says {humanInterval(item.learnedDays)}.
        </p>
      )}
    </li>
  )
}

export function Config() {
  const list = usePolled('event-driven', getItems)
  const [label, setLabel] = useState('')
  const [days, setDays] = useState(String(DEFAULT_INTERVAL_DAYS))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const items: ItemView[] = list.status === 'ok' ? list.data.items : []

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
      await addItem(trimmed, Number(days) || DEFAULT_INTERVAL_DAYS)
      setLabel('')
      setDays(String(DEFAULT_INTERVAL_DAYS))
    })
    setSaving(false)
  }

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-sm font-semibold tracking-tight">Add something</h2>
        <p className="text-ink-dim mt-1 text-xs">
          The interval is only a starting guess. Once there are a few taps to go on, it swaps to
          what you actually do — pin it if you'd rather it held still.
        </p>

        <form onSubmit={create} className="mt-3 flex flex-wrap items-end gap-2">
          {/* Full width on a phone — see the note in countdowns' Config; the
              same row of controls squeezes a flexing field to nothing.

              The caption spans are `block` on purpose: a bare inline span sits
              *beside* its input unless the input happens to be full-width,
              which had "Name" captioned above and "Every" captioned to the
              left in the same form. */}
          <label className="w-full min-w-0 sm:w-auto sm:flex-1">
            <span className="text-ink-dim block text-xs">Name</span>
            <input
              value={label}
              maxLength={MAX_LABEL}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Change the water filter"
              className={`border-line focus:border-accent ${TOUCH} mt-1 w-full border bg-transparent px-2 text-sm outline-none`}
            />
          </label>

          <label>
            <span className="text-ink-dim block text-xs">Every</span>
            <input
              type="number"
              min={1}
              max={3650}
              value={days}
              onChange={(event) => setDays(event.target.value)}
              className={`border-line focus:border-accent ${TOUCH} mt-1 w-20 border bg-transparent px-2 text-center font-mono text-sm outline-none`}
            />
          </label>

          <button
            type="submit"
            disabled={saving || !label.trim() || items.length >= MAX_ITEMS}
            className={`border-accent text-accent hover:bg-accent/10 ${TOUCH} border px-4 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40`}
          >
            {saving ? 'adding…' : 'add'}
          </button>
        </form>

        {items.length >= MAX_ITEMS && (
          <p className="text-ink-dim mt-2 text-xs">That's the {MAX_ITEMS}-item ceiling.</p>
        )}
        {error && <p className="text-danger mt-2 text-xs">{error}</p>}
      </section>

      <section>
        <h2 className="text-sm font-semibold tracking-tight">Tracking</h2>

        {list.status === 'loading' && <p className="text-ink-dim mt-3 text-sm">loading…</p>}
        {list.status === 'error' && <p className="text-danger mt-3 text-sm">{list.message}</p>}

        {list.status === 'ok' && items.length === 0 && (
          <p className="text-ink-dim mt-3 text-sm italic">
            Nothing yet. Add the first thing above.
          </p>
        )}

        <ul className="mt-3 space-y-2">
          {items.map((item) => (
            <Row
              key={item.id}
              item={item}
              onPatch={(patch) => run(() => patchItem(item.id, patch))}
              onDelete={() => run(() => deleteItem(item.id))}
            />
          ))}
        </ul>
      </section>
    </div>
  )
}
