import { useState } from 'react'
import { IMPLEMENTS, type Implement, type Inventory } from '@shared/trainer'
import { usePolled } from '../../lib/refresh'
import { importVault, putSettings, getSettings, type Settings } from './api'

/**
 * Equipment, the imported log, and the policy the model gets briefed with.
 *
 * The equipment editor is the interesting one: **every load ladder is derived
 * from it**, so the ladders shown beneath update the moment you change a line.
 * That is the whole reason the inventory is data rather than a paragraph — buy
 * a heavier pair and every future prescription moves with it, with nothing to
 * edit anywhere else.
 */

const TOUCH = 'min-h-11'

const IMPLEMENT_LABEL: Record<Implement, string> = {
  bar: 'EZ bar + plates',
  plates: 'Plates only (leg attachment)',
  'dumbbell-pair': 'Dumbbells, both hands',
  'dumbbell-single': 'One dumbbell',
  bodyweight: 'Bodyweight',
  'bodyweight-plus': 'Bodyweight + a dumbbell',
}

function PairEditor({
  title,
  hint,
  pairs,
  onChange,
}: {
  title: string
  hint: string
  pairs: { lb: number; pairs: number }[]
  onChange: (next: { lb: number; pairs: number }[]) => void
}) {
  const [lb, setLb] = useState('')

  return (
    <div>
      <p className="text-sm font-medium">{title}</p>
      <p className="text-ink-dim mt-0.5 text-xs">{hint}</p>

      <ul className="mt-2 space-y-1">
        {pairs.map((entry, index) => (
          <li key={`${entry.lb}-${index}`} className="flex items-center gap-2">
            <span className="font-mono text-sm tabular-nums">{entry.lb} lb</span>
            <span className="text-ink-dim text-xs">×</span>
            <input
              type="number"
              min={1}
              max={20}
              value={entry.pairs}
              onChange={(event) => {
                const count = Number(event.target.value)
                if (!Number.isInteger(count) || count < 1) return
                onChange(pairs.map((p, i) => (i === index ? { ...p, pairs: count } : p)))
              }}
              aria-label={`How many ${entry.lb} lb pairs`}
              className={`border-line focus:border-accent ${TOUCH} w-20 border bg-transparent px-2 text-center font-mono text-xs outline-none`}
            />
            <span className="text-ink-dim text-xs">pairs</span>
            <button
              type="button"
              onClick={() => onChange(pairs.filter((_, i) => i !== index))}
              aria-label={`Remove the ${entry.lb} lb pairs`}
              className={`border-line text-ink-dim hover:border-danger hover:text-danger ${TOUCH} ml-auto w-11 shrink-0 border text-xs transition-colors`}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-2 flex items-end gap-2">
        <label>
          <span className="text-ink-dim block text-xs">Add a weight</span>
          <input
            type="number"
            min={1}
            max={200}
            value={lb}
            onChange={(event) => setLb(event.target.value)}
            placeholder="lb"
            className={`border-line focus:border-accent ${TOUCH} mt-1 w-24 border bg-transparent px-2 text-center font-mono text-sm outline-none`}
          />
        </label>
        <button
          type="button"
          disabled={!Number(lb)}
          onClick={() => {
            const weight = Number(lb)
            if (!weight || pairs.some((entry) => entry.lb === weight)) return
            onChange([...pairs, { lb: weight, pairs: 1 }].sort((a, b) => a.lb - b.lb))
            setLb('')
          }}
          className={`border-accent text-accent hover:bg-accent/10 ${TOUCH} border px-4 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40`}
        >
          add
        </button>
      </div>
    </div>
  )
}

function Ladders({ ladders }: { ladders: Record<Implement, number[]> }) {
  return (
    <div>
      <p className="text-sm font-medium">What that builds</p>
      <p className="text-ink-dim mt-0.5 text-xs">
        Every load reachable with what you own. These are computed, never stored — a prescription
        can only ever land on one of these numbers.
      </p>
      <dl className="mt-2 space-y-1.5">
        {IMPLEMENTS.map((implement) => (
          <div key={implement}>
            <dt className="text-ink-dim text-[0.65rem] tracking-wide uppercase">
              {IMPLEMENT_LABEL[implement]}
            </dt>
            <dd className="font-mono text-xs tabular-nums">
              {ladders[implement]?.length ? ladders[implement].join(' · ') : '—'}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export function SettingsTab() {
  const loaded = usePolled('event-driven', getSettings)
  const [override, setOverride] = useState<Settings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [markdown, setMarkdown] = useState('')
  const [importing, setImporting] = useState(false)
  const [report, setReport] = useState<{
    imported: number
    replaced: number
    notes: string[]
  } | null>(null)

  const settings = override ?? (loaded.status === 'ok' ? loaded.data : null)
  const [policyDraft, setPolicyDraft] = useState<string | null>(null)

  async function save(patch: Parameters<typeof putSettings>[0]) {
    setError(null)
    setSaving(true)
    try {
      setOverride(await putSettings(patch))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'could not save that')
    } finally {
      setSaving(false)
    }
  }

  async function runImport() {
    setError(null)
    setImporting(true)
    try {
      setReport(await importVault(markdown))
      setMarkdown('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'could not import that')
    } finally {
      setImporting(false)
    }
  }

  if (loaded.status === 'loading' && !settings) {
    return <p className="text-ink-dim text-sm">loading…</p>
  }
  if (loaded.status === 'error' && !settings) {
    return <p className="text-danger text-sm">{loaded.message}</p>
  }
  if (!settings) return null

  const inventory = settings.inventory
  const update = (next: Partial<Inventory>) => save({ inventory: { ...inventory, ...next } })
  const policy = policyDraft ?? settings.policy

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">Equipment</h2>
          <p className="text-ink-dim mt-1 text-xs">
            Change a line here and every ladder below regrows, along with every future prescription.
            Nothing else needs editing.
          </p>
        </div>

        <label className="block">
          <span className="text-ink-dim block text-xs">Bar weight</span>
          <input
            type="number"
            min={0}
            max={200}
            defaultValue={inventory.barLb}
            onBlur={(event) => {
              const barLb = Number(event.target.value)
              if (Number.isFinite(barLb) && barLb !== inventory.barLb) void update({ barLb })
            }}
            className={`border-line focus:border-accent ${TOUCH} mt-1 w-24 border bg-transparent px-2 text-center font-mono text-sm outline-none`}
          />
        </label>

        <PairEditor
          title="Plates"
          hint="Bought and loaded in pairs, so one entry is one plate's weight."
          pairs={inventory.plates}
          onChange={(plates) => void update({ plates })}
        />

        <PairEditor
          title="Dumbbells"
          hint="A pair is two of the same weight."
          pairs={inventory.dumbbells}
          onChange={(dumbbells) => void update({ dumbbells })}
        />

        <Ladders ladders={settings.ladders} />
        {saving && <p className="text-ink-dim font-mono text-xs">saving…</p>}
      </section>

      <section>
        <h2 className="text-sm font-semibold tracking-tight">Import your log</h2>
        <p className="text-ink-dim mt-1 text-xs">
          Paste the contents of <code>workout-log.md</code>. Import is one-way and nothing is ever
          written back to the vault. Re-importing replaces the sessions it covers rather than
          doubling them, and anything the parser can't read cleanly is kept as a note instead of
          being dropped.
        </p>

        <textarea
          value={markdown}
          onChange={(event) => setMarkdown(event.target.value)}
          rows={6}
          placeholder="### 2026-07-22 — Lower Body …"
          className="border-line bg-surface focus:border-accent mt-3 w-full resize-y border p-3 font-mono text-xs outline-none"
        />

        <button
          type="button"
          onClick={() => void runImport()}
          disabled={importing || markdown.trim().length === 0}
          className={`border-accent text-accent hover:bg-accent/10 ${TOUCH} mt-2 border px-4 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40`}
        >
          {importing ? 'importing…' : 'import'}
        </button>

        {report && (
          <div className="border-line mt-3 border p-3">
            <p className="font-mono text-xs">
              {report.imported} session{report.imported === 1 ? '' : 's'} imported
              {report.replaced > 0 ? `, ${report.replaced} replaced` : ''}
            </p>
            {report.notes.length > 0 && (
              <ul className="text-ink-dim mt-2 space-y-0.5 text-[0.65rem]">
                {report.notes.map((note, index) => (
                  <li key={index}>· {note}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold tracking-tight">The brief</h2>
        <p className="text-ink-dim mt-1 text-xs">
          The policy the model gets alongside each session — the knee protocol, how conditioning is
          handled, how hard to push. It stays on this box and is never written into the repo.
        </p>

        <textarea
          value={policy}
          onChange={(event) => setPolicyDraft(event.target.value)}
          rows={10}
          placeholder="Paste the guide's policy sections here…"
          className="border-line bg-surface focus:border-accent mt-3 w-full resize-y border p-3 font-mono text-xs outline-none"
        />

        <button
          type="button"
          onClick={() => void save({ policy })}
          disabled={saving || policy === settings.policy}
          className={`border-accent text-accent hover:bg-accent/10 ${TOUCH} mt-2 border px-4 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40`}
        >
          save the brief
        </button>
      </section>

      {error && <p className="text-danger text-xs">{error}</p>}
    </div>
  )
}
