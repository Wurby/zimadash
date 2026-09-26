import { useState } from 'react'
import { Icon } from '../../components/Icon'
import { putWeight } from './api'

/**
 * Today's weigh-in, always available regardless of whether the WeightBar
 * display is turned on — logging shouldn't depend on a display toggle. Same
 * idle-icon → active-input → brief-checkmark shape as the digestion quick log.
 */

const pad = (n: number): string => String(n).padStart(2, '0')

function todayKey(): string {
  const d = new Date()
  // Matches the server's 4am rollover, so a pre-dawn weigh-in files where the
  // rest of that night's food went.
  if (d.getHours() < 4) d.setDate(d.getDate() - 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function WeightQuickLog({ onLogged }: { onLogged: () => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  async function submit() {
    const lb = Number(value)
    if (!Number.isFinite(lb) || lb <= 0 || busy) return
    setBusy(true)
    try {
      await putWeight(todayKey(), lb)
      setValue('')
      setEditing(false)
      onLogged()
      setDone(true)
      setTimeout(() => setDone(false), 5000)
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div
        aria-label="Logged"
        className="border-accent text-accent grid min-h-11 min-w-11 place-items-center border"
      >
        <Icon name="check" />
      </div>
    )
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label="Log today's weight"
        className="border-line hover:border-accent grid min-h-11 min-w-11 place-items-center border text-lg leading-none"
      >
        ⚖️
      </button>
    )
  }

  return (
    <div className="flex gap-2">
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => event.key === 'Enter' && void submit()}
        onBlur={() => {
          if (!value.trim()) setEditing(false)
        }}
        inputMode="decimal"
        autoFocus
        disabled={busy}
        placeholder="lb"
        className="border-line focus:border-accent w-16 border bg-transparent px-2 py-1 font-mono text-sm outline-none disabled:opacity-50"
      />
      <button
        type="button"
        onClick={() => void submit()}
        disabled={busy || !value.trim()}
        className="bg-accent min-h-11 px-3 text-xs font-medium text-slate-50 disabled:opacity-50 dark:text-slate-900"
      >
        Log
      </button>
    </div>
  )
}
