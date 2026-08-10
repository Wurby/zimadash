import { useState } from 'react'
import type { Entry, PendingEstimate, Settings } from '@shared/calories'
import { Icon } from '../../components/Icon'
import { usePolled } from '../../lib/refresh'
import { deleteEntry, getLog, patchEntry, reestimateEntry, tracked } from './api'
import { derivedCalories } from './macros'

/**
 * Roughly two weeks of meals, newest first.
 *
 * Two ways to correct one. **Edit** overwrites the numbers by hand, for when you
 * already know what they should say. **Edit with AI** takes a sentence instead
 * and re-runs the estimate seeded from what was recorded — the same loop as the
 * magic bar, except approving updates this entry rather than creating one.
 *
 * A deletion asks first: it is the only thing in the tool that destroys history.
 */

function Row({
  entry,
  fields,
  onChanged,
}: {
  entry: Entry
  fields: ReturnType<typeof tracked>
  onChanged: () => void
}) {
  const [editing, setEditing] = useState(false)
  // Held as strings while editing, not numbers. A controlled number input that
  // coerces with Number() turns an emptied box into 0, so deleting "23" to
  // retype leaves a stubborn zero and you end up with "033".
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [proposal, setProposal] = useState<PendingEstimate | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)

  function startEdit() {
    setDraft(
      Object.fromEntries(
        fields.map((field) => [
          field.id,
          entry.values[field.id] === undefined ? '' : String(entry.values[field.id]),
        ]),
      ),
    )
    setEditing(true)
  }

  const when = new Date(entry.at).toLocaleString([], {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

  // What the macros currently in the boxes add up to. Offered only when it
  // meaningfully disagrees with the calorie figure — the two legitimately
  // differ by a few kcal, and nagging about rounding would be noise.
  const asNumbers = Object.fromEntries(
    Object.entries(draft).map(([id, raw]) => [id, Number(raw) || 0]),
  )
  const fromMacros = Math.round(derivedCalories(asNumbers))
  const suggestion =
    fromMacros > 0 && Math.abs(fromMacros - (Number(draft.calories) || 0)) > 15 ? fromMacros : null

  async function save() {
    // An emptied box means "no value for this field", not zero — so it is
    // dropped rather than written as a 0 you never entered.
    const values = Object.fromEntries(
      Object.entries(draft)
        .filter(([, raw]) => raw.trim() !== '' && Number.isFinite(Number(raw)))
        .map(([id, raw]) => [id, Number(raw)]),
    )

    setBusy(true)
    try {
      await patchEntry(entry.id, values)
      setEditing(false)
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    try {
      await deleteEntry(entry.id)
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  /**
   * Correcting a logged meal in words rather than numbers. The server seeds an
   * ordinary estimate thread from what was recorded, so this is the same loop
   * as the magic bar — the only difference is that approving updates the entry
   * instead of creating one.
   */
  async function ask() {
    const said = prompt.trim()
    if (!said || busy) return
    setAiError(null)
    setBusy(true)
    try {
      setProposal(await reestimateEntry(entry.id, said))
      setPrompt('')
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'could not rethink that')
    } finally {
      setBusy(false)
    }
  }

  async function applyProposal() {
    if (!proposal) return
    setBusy(true)
    try {
      await patchEntry(entry.id, proposal.values)
      setProposal(null)
      setAsking(false)
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="px-1 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate text-sm font-medium">
          {entry.description || <span className="text-ink-dim italic">quick entry</span>}
        </p>
        <span className="text-ink-dim shrink-0 font-mono text-xs tabular-nums">{when}</span>
      </div>

      {entry.assumptions && !editing && (
        <p className="text-ink-dim mt-1 text-xs italic">{entry.assumptions}</p>
      )}

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
        {fields.map((field) =>
          editing ? (
            // The label stays while editing — a row of coloured boxes with no
            // words is a guessing game, and a narrower input leaves room for it.
            <label key={field.id} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="size-2 shrink-0"
                style={{ background: field.color }}
              />
              <span className="text-ink-dim text-[0.65rem] tracking-wide uppercase">
                {field.label}
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={draft[field.id] ?? ''}
                onChange={(e) => setDraft({ ...draft, [field.id]: e.target.value })}
                // Sized for six monospace characters at 16px, which is what
                // this becomes on a touch screen — "103.5" has to fit without
                // the field scrolling under your thumb while you type.
                className="border-line focus:border-accent w-18 border bg-transparent px-1.5 py-1 font-mono text-xs outline-none"
              />
            </label>
          ) : entry.values[field.id] === undefined ? null : (
            <span key={field.id} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="size-2 shrink-0"
                style={{ background: field.color }}
              />
              <span className="text-ink-dim text-[0.65rem] tracking-wide uppercase">
                {field.label}
              </span>
              <span className="font-mono text-xs tabular-nums">
                {Math.round(entry.values[field.id])}
                {field.unit === 'kcal' ? '' : field.unit}
              </span>
            </span>
          ),
        )}
      </div>

      {asking && (
        <div className="border-accent mt-3 border p-3">
          {proposal ? (
            <>
              <p className="text-ink-dim text-xs italic">{proposal.assumptions}</p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {fields.map((field) => {
                  const next = proposal.values[field.id]
                  if (next === undefined) return null
                  const before = entry.values[field.id]
                  return (
                    <span key={field.id} className="flex items-center gap-1.5">
                      <span
                        aria-hidden="true"
                        className="size-2 shrink-0"
                        style={{ background: field.color }}
                      />
                      <span className="text-ink-dim text-[0.65rem] tracking-wide uppercase">
                        {field.label}
                      </span>
                      {/* Show what it was as well as what it would become —
                          approving a change you can't see is just trust. */}
                      {before !== undefined && Math.round(before) !== Math.round(next) && (
                        <span className="text-ink-dim font-mono text-xs line-through tabular-nums">
                          {Math.round(before)}
                        </span>
                      )}
                      <span className="font-mono text-xs tabular-nums">{Math.round(next)}</span>
                    </span>
                  )
                })}
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={applyProposal}
                  disabled={busy}
                  className="bg-accent grow px-3 py-1.5 text-xs font-medium text-slate-50 disabled:opacity-50 dark:text-slate-900"
                >
                  {busy ? 'working…' : 'Apply'}
                </button>
                <button
                  type="button"
                  onClick={() => setProposal(null)}
                  className="border-line hover:border-accent border px-3 py-1.5 text-xs"
                >
                  Ask again
                </button>
              </div>
            </>
          ) : (
            <input
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && void ask()}
              disabled={busy}
              autoFocus
              placeholder="What was wrong with it?"
              className="border-line focus:border-accent w-full border bg-transparent px-3 py-2 text-sm outline-none disabled:opacity-50"
            />
          )}

          {busy && !proposal && (
            <p className="text-ink-dim mt-2 animate-pulse font-mono text-xs">rethinking…</p>
          )}
          {aiError && <p className="text-danger mt-2 text-xs">{aiError}</p>}
        </div>
      )}

      {editing && suggestion !== null && (
        <p className="text-ink-dim mt-2 flex items-center gap-2 font-mono text-xs">
          macros come to {suggestion} kcal
          <button
            type="button"
            onClick={() => setDraft({ ...draft, calories: String(suggestion) })}
            className="border-line hover:border-accent text-ink border px-2 py-0.5"
          >
            use it
          </button>
        </p>
      )}

      <div className="mt-3 flex items-center gap-2">
        {editing ? (
          <>
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="bg-accent px-3 py-1.5 text-xs font-medium text-slate-50 disabled:opacity-50 dark:text-slate-900"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="border-line hover:border-accent border px-3 py-1.5 text-xs"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={startEdit}
              className="border-line hover:border-accent border px-3 py-1.5 text-xs"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => {
                setAsking((was) => !was)
                setProposal(null)
                setAiError(null)
              }}
              aria-label="Correct this with a description"
              className={`flex items-center gap-1.5 border px-3 py-1.5 text-xs ${
                asking ? 'border-accent text-accent' : 'border-line hover:border-accent'
              }`}
            >
              <Icon name="sparkle" />
              Edit with AI
            </button>
          </>
        )}

        <button
          type="button"
          onClick={() => (confirming ? remove() : setConfirming(true))}
          onBlur={() => setConfirming(false)}
          disabled={busy}
          className={`ml-auto border px-3 py-1.5 text-xs disabled:opacity-50 ${
            confirming ? 'border-danger text-danger' : 'border-line hover:border-danger'
          }`}
        >
          {confirming ? 'Tap again to delete' : 'Delete'}
        </button>

        {entry.edited && <span className="text-ink-dim font-mono text-[0.65rem]">edited</span>}
      </div>
    </li>
  )
}

export function LogTab({ settings }: { settings: Settings | null }) {
  const log = usePolled('event-driven', () => getLog().then((r) => r.entries))
  const fields = tracked(settings)

  if (log.status === 'loading') return <p className="text-ink-dim text-sm">loading…</p>
  if (log.status === 'error') return <p className="text-danger text-sm">{log.message}</p>
  if (log.data.length === 0) {
    return <p className="text-ink-dim text-sm">Nothing logged in the last two weeks.</p>
  }

  // A plain divided list rather than a stack of cards — the colours and the
  // description already separate one meal from the next.
  return (
    <ul className="divide-line divide-y">
      {log.data.map((entry) => (
        <Row key={entry.id} entry={entry} fields={fields} onChanged={log.refresh} />
      ))}
    </ul>
  )
}
