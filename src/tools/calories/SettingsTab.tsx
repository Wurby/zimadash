import { useState } from 'react'
import type { FieldConfig, Settings } from '@shared/calories'
import { SWATCHES } from '@shared/calories'
import { getWeight, putSettings } from './api'
import { usePolled } from '../../lib/refresh'

/**
 * What gets tracked, what it's called, what colour it is, and what you're
 * aiming for.
 *
 * The five core fields can be renamed and recoloured but never removed —
 * everything else in the tool assumes they exist. A custom field can be turned
 * off, which keeps its history and stops asking the brain for it, or deleted,
 * which takes the history with it.
 *
 * Colours come from a fixed set rather than a free picker. Every swatch has been
 * checked for lightness, chroma, colour-vision separation and 3:1 contrast
 * against both the light and dark surfaces; a hex field would happily let you
 * choose a yellow that vanishes on white.
 */

function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean
  onChange: (next: boolean) => void
  label: string
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs">
      <input
        type="checkbox"
        checked={on}
        onChange={(event) => onChange(event.target.checked)}
        className="accent-accent size-4"
      />
      <span className="text-ink-dim tracking-wide uppercase">{label}</span>
    </label>
  )
}

function FieldRow({
  field,
  onChange,
  onDelete,
}: {
  field: FieldConfig
  onChange: (next: FieldConfig) => void
  onDelete: () => void
}) {
  const [confirming, setConfirming] = useState(false)

  return (
    <li className="border-line bg-surface border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span aria-hidden="true" className="size-3 shrink-0" style={{ background: field.color }} />
        <input
          value={field.label}
          onChange={(event) => onChange({ ...field, label: event.target.value })}
          className="border-line focus:border-accent min-w-0 flex-1 border bg-transparent px-2 py-1 text-sm outline-none"
        />
        <input
          value={field.unit}
          onChange={(event) => onChange({ ...field, unit: event.target.value })}
          placeholder="unit"
          className="border-line focus:border-accent w-20 border bg-transparent px-2 py-1 font-mono text-xs outline-none"
        />
        <input
          type="number"
          inputMode="decimal"
          value={field.goal ?? ''}
          onChange={(event) =>
            onChange({
              ...field,
              goal: event.target.value === '' ? null : Number(event.target.value),
            })
          }
          placeholder="goal"
          className="border-line focus:border-accent w-24 border bg-transparent px-2 py-1 font-mono text-xs outline-none"
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {/* Calories has no colour of its own — its bar is built from the macro
            colours, so a swatch here would be a colour nothing ever draws. */}
        {field.id === 'calories' ? (
          <p className="text-ink-dim text-xs">Coloured by its macro breakdown.</p>
        ) : (
          <div className="flex gap-1.5">
            {SWATCHES.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`Use ${color} for ${field.label}`}
                onClick={() => onChange({ ...field, color })}
                className={`size-5 border-2 ${
                  field.color === color ? 'border-ink' : 'border-transparent'
                }`}
                style={{ background: color }}
              />
            ))}
          </div>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-3">
          {field.id === 'calories' ? (
            <span className="text-ink-dim text-xs tracking-wide uppercase">Always on tile</span>
          ) : (
            <Toggle
              on={field.onTile}
              onChange={(onTile) => onChange({ ...field, onTile })}
              label="Tile"
            />
          )}
          <Toggle
            on={field.onMain}
            onChange={(onMain) => onChange({ ...field, onMain })}
            label="Graph on main"
          />
          {!field.core && (
            <>
              <Toggle
                on={field.tracked}
                onChange={(t) => onChange({ ...field, tracked: t })}
                label="Tracking"
              />
              <button
                type="button"
                onClick={() => (confirming ? onDelete() : setConfirming(true))}
                onBlur={() => setConfirming(false)}
                className={`border px-2 py-1 text-xs ${
                  confirming ? 'border-danger text-danger' : 'border-line hover:border-danger'
                }`}
              >
                {confirming ? 'Delete field and its data?' : 'Delete'}
              </button>
            </>
          )}
        </div>
      </div>
    </li>
  )
}

export function SettingsTab({
  settings,
  onSaved,
}: {
  settings: Settings | null
  onSaved: (next: Settings) => void
}) {
  const [draft, setDraft] = useState<Settings | null>(settings)
  const [busy, setBusy] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  // Above the early return: hooks can't sit behind a conditional.
  const weight = usePolled('event-driven', getWeight)

  const current = draft ?? settings
  if (!current) return <p className="text-ink-dim text-sm">loading…</p>

  function update(next: Settings) {
    setDraft(next)
  }

  async function save() {
    if (!draft) return
    setBusy(true)
    try {
      onSaved(await putSettings(draft))
    } finally {
      setBusy(false)
    }
  }

  function addField() {
    const label = newLabel.trim()
    if (!label) return
    const id = label.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    if (current!.fields.some((field) => field.id === id)) return

    update({
      ...current!,
      fields: [
        ...current!.fields,
        {
          id,
          label,
          unit: 'g',
          color: SWATCHES[current!.fields.length % SWATCHES.length],
          core: false,
          tracked: true,
          goal: null,
          onTile: false,
          onMain: false,
        },
      ],
    })
    setNewLabel('')
  }

  const computed = weight.status === 'ok' ? weight.data.expenditure : null
  const manualGoal = current.fields.find((field) => field.id === 'calories')?.goal ?? null
  const useComputed = current.weight.useComputedTarget

  return (
    <div className="space-y-4">
      {/* Both numbers sit beside the switch, because choosing between them
          blind means trusting one you have never met. */}
      <div className="border-line bg-surface border p-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-ink-dim text-[0.65rem] font-medium tracking-wide uppercase">
            Calorie target
          </span>
          <div className="ml-auto flex gap-1">
            {(
              [
                ['Set by hand', false, manualGoal],
                ['Learned', true, computed?.target ?? null],
              ] as const
            ).map(([label, value, number]) => (
              <button
                key={label}
                type="button"
                onClick={() =>
                  update({ ...current, weight: { ...current.weight, useComputedTarget: value } })
                }
                aria-pressed={useComputed === value}
                disabled={value && computed?.status !== 'ready'}
                className={`border px-3 py-1.5 text-xs disabled:opacity-40 ${
                  useComputed === value
                    ? 'border-accent text-accent'
                    : 'border-line hover:border-accent'
                }`}
              >
                {label}
                <span className="ml-1.5 font-mono tabular-nums">{number ?? '—'}</span>
              </button>
            ))}
          </div>
        </div>
        {computed?.status !== 'ready' && (
          <p className="text-ink-dim mt-2 text-xs">
            The learned target needs {computed?.daysNeeded ?? 7} more day
            {computed?.daysNeeded === 1 ? '' : 's'} of food and weigh-ins before it can be used.
          </p>
        )}
      </div>

      <label className="border-line bg-surface flex cursor-pointer items-center gap-2 border p-3 text-xs">
        <input
          type="checkbox"
          checked={current.weight.onTile}
          onChange={(event) =>
            update({ ...current, weight: { ...current.weight, onTile: event.target.checked } })
          }
          className="accent-accent size-4"
        />
        <span className="text-ink-dim tracking-wide uppercase">Weight bar on the tile</span>
      </label>

      <ul className="space-y-2">
        {current.fields.map((field) => (
          <FieldRow
            key={field.id}
            field={field}
            onChange={(next) =>
              update({
                ...current,
                fields: current.fields.map((f) => (f.id === field.id ? next : f)),
              })
            }
            onDelete={() =>
              update({ ...current, fields: current.fields.filter((f) => f.id !== field.id) })
            }
          />
        ))}
      </ul>

      <div className="flex gap-2">
        <input
          value={newLabel}
          onChange={(event) => setNewLabel(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && addField()}
          placeholder="Track something else — added sugars, sodium…"
          className="border-line bg-surface focus:border-accent min-w-0 flex-1 border px-3 py-2 text-sm outline-none"
        />
        <button
          type="button"
          onClick={addField}
          className="border-line hover:border-accent border px-4 py-2 text-sm font-medium"
        >
          Add
        </button>
      </div>

      <button
        type="button"
        onClick={save}
        disabled={busy || draft === null}
        className="bg-accent w-full px-4 py-2.5 text-sm font-medium text-slate-50 disabled:opacity-50 dark:text-slate-900"
      >
        {busy ? 'saving…' : 'Save settings'}
      </button>

      <p className="text-ink-dim text-xs">
        Core fields can be renamed and recoloured but not removed. Turning a custom field off keeps
        its history; deleting it does not.
      </p>
    </div>
  )
}
