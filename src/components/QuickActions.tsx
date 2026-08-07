import { useEffect, useRef, useState } from 'react'
import type { ActionSummary } from '@shared/types'
import { api } from '../lib/api'
import { usePolled } from '../lib/refresh'
import { Icon } from './Icon'

/**
 * One-tap actions that fire real side effects.
 *
 * The browser only ever knows an action's id, label, and icon — the URL and any
 * credential live in DATA_DIR on the server, which makes the call. See
 * server/src/actions.ts.
 *
 * A tapped action swaps its icon for a checkmark for 5 seconds. That is the
 * whole feedback mechanism: there is no toast, because this has to read
 * correctly from across a room.
 */

const CONFIRM_MS = 5_000

type Status = 'idle' | 'firing' | 'done' | 'failed'

function ActionButton({ action }: { action: ActionSummary }) {
  const [status, setStatus] = useState<Status>('idle')
  const [armed, setArmed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  function settle(next: Status) {
    setStatus(next)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setStatus('idle'), CONFIRM_MS)
  }

  async function fire() {
    // Destructive actions get a second tap rather than a modal — a dialog is
    // the wrong weight for a wall display, but a robovac shouldn't launch
    // because the tablet was brushed on the way past.
    if (action.confirm && !armed) {
      setArmed(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setArmed(false), CONFIRM_MS)
      return
    }

    setArmed(false)
    setStatus('firing')
    try {
      await api(`/api/actions/${action.id}/fire`, { method: 'POST' })
      settle('done')
    } catch {
      settle('failed')
    }
  }

  const icon = status === 'done' ? 'check' : status === 'failed' ? 'bolt' : action.icon
  const tone =
    status === 'done'
      ? 'text-accent border-accent'
      : status === 'failed'
        ? 'text-danger border-danger'
        : armed
          ? 'text-danger border-danger'
          : 'border-line hover:border-accent'

  return (
    <button
      type="button"
      onClick={fire}
      disabled={status === 'firing'}
      title={armed ? `Tap again to confirm — ${action.label}` : action.label}
      aria-label={armed ? `Confirm ${action.label}` : action.label}
      className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 transition-colors disabled:opacity-50 ${tone}`}
    >
      <Icon name={icon} className={status === 'firing' ? 'animate-pulse' : ''} />
      <span className="hidden text-xs font-medium sm:inline">
        {armed ? 'Confirm?' : action.label}
      </span>
    </button>
  )
}

export function QuickActions() {
  // The action list changes only when you edit actions.json on the server, so
  // it loads once rather than on a clock.
  const state = usePolled('event-driven', () =>
    api<{ actions: ActionSummary[] }>('/api/actions').then((body) => body.actions),
  )

  if (state.status !== 'ok' || state.data.length === 0) return null

  return (
    <div className="flex items-center gap-2">
      {state.data.map((action) => (
        <ActionButton key={action.id} action={action} />
      ))}
    </div>
  )
}
