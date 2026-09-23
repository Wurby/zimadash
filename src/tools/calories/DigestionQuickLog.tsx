import { useState } from 'react'
import type { Severity } from '@shared/calories'
import { Icon } from '../../components/Icon'
import { logEpisode } from './api'

/**
 * The Today-tab shortcut for the Digestion tab's "Problem" button — same log
 * action, compact enough to sit beside the calorie bar. Idle is a single
 * emoji tap target; tapping it swaps in the three severities. Tapping a
 * severity arms it (border + dim the other two) and a second tap on the same
 * one fires the log, same "tap again" gesture as elsewhere in this tool.
 */

const SEVERITIES: Severity[] = [1, 2, 3]
const CONFIRM_MS = 5000

export function DigestionQuickLog() {
  const [picking, setPicking] = useState(false)
  const [armed, setArmed] = useState<Severity | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  async function fire(severity: Severity) {
    setBusy(true)
    try {
      await logEpisode(severity)
      setPicking(false)
      setArmed(null)
      setDone(true)
      setTimeout(() => setDone(false), CONFIRM_MS)
    } finally {
      setBusy(false)
    }
  }

  function tap(severity: Severity) {
    if (armed === severity) void fire(severity)
    else setArmed(severity)
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

  if (!picking) {
    return (
      <button
        type="button"
        onClick={() => setPicking(true)}
        aria-label="Log a digestive issue"
        className="border-line hover:border-danger grid min-h-11 min-w-11 place-items-center border text-lg leading-none"
      >
        💩
      </button>
    )
  }

  return (
    <div
      className="flex gap-1"
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return
        setPicking(false)
        setArmed(null)
      }}
    >
      {SEVERITIES.map((severity) => (
        <button
          key={severity}
          type="button"
          disabled={busy}
          onClick={() => tap(severity)}
          aria-label={
            armed === severity
              ? `Tap again to confirm severity ${severity}`
              : `Severity ${severity}`
          }
          className={`min-h-11 min-w-11 border text-sm font-medium disabled:opacity-50 ${
            armed === severity
              ? 'border-danger text-danger'
              : armed !== null
                ? 'border-line text-ink-dim opacity-50'
                : 'border-line hover:border-danger'
          }`}
        >
          {severity}
        </button>
      ))}
    </div>
  )
}
