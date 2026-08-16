import { useEffect, useRef, useState } from 'react'
import type { InboxStatus } from '@shared/inbox'
import { usePolled } from '../../lib/refresh'
import { defineTool } from '../types'
import meta from './meta.json'
import { getInbox, uploadFile } from './api'
import { InboxView } from './InboxView'

/**
 * Inbox — drop a file, the brain files it.
 *
 * Fire-and-forget: picking a file uploads it immediately (with an optional
 * one-line instruction), the tile confirms with a checkmark, and placement
 * happens in the background with no further UI.
 *
 * `ambient` rather than `event-driven`, even though nothing changes until you
 * upload something — once you do, a row moves working -> placed on its own
 * over the next 30-180 seconds with no further action, which is exactly what
 * `event-driven` excludes. `ambient`'s ordinary poll is also what delivers
 * "check whenever you next look" for free, with no separate job-status
 * endpoint.
 *
 * `interactiveTile: true` — uploading is the doing and belongs on the grid;
 * the route is where you read the log.
 */

const SENT_MS = 5_000

const STATUS_TEXT: Record<InboxStatus, string> = {
  working: 'filing…',
  placed: 'filed',
  unsorted: 'unsorted',
  failed: 'failed',
}

const STATUS_TONE: Record<InboxStatus, string> = {
  working: 'text-ink-dim',
  placed: 'text-accent',
  unsorted: 'text-amber-700 dark:text-amber-400',
  failed: 'text-danger',
}

function Tile() {
  const state = usePolled('ambient', getInbox)
  const [picked, setPicked] = useState<File | null>(null)
  const [instructions, setInstructions] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  async function send() {
    if (!picked) return
    setSending(true)
    setError(null)
    try {
      await uploadFile(picked, instructions.trim())
      setPicked(null)
      setInstructions('')
      setSent(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setSent(false), SENT_MS)
      state.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'upload failed')
    } finally {
      setSending(false)
    }
  }

  const entries = state.status === 'ok' ? state.data.entries : []
  const configured = state.status === 'ok' ? state.data.configured : true
  const recent = entries.slice(0, 2)

  if (sent) {
    return (
      <div className="text-accent grid h-full place-items-center">
        <span className="text-2xl">✓</span>
      </div>
    )
  }

  if (picked) {
    return (
      <div className="flex h-full flex-col justify-between gap-2">
        <p className="truncate text-xs font-medium">{picked.name}</p>
        <input
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
          placeholder="Instructions (optional)"
          className="border-line focus:border-accent min-h-11 w-full border bg-transparent px-2 text-sm outline-none"
        />
        {error && <p className="text-danger text-xs">{error}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void send()}
            disabled={sending}
            className="border-accent text-accent hover:bg-accent/10 min-h-11 flex-1 border text-sm transition-colors disabled:opacity-50"
          >
            {sending ? 'sending…' : 'send'}
          </button>
          <button
            type="button"
            onClick={() => {
              setPicked(null)
              setError(null)
            }}
            disabled={sending}
            className="border-line text-ink-dim hover:border-danger hover:text-danger min-h-11 border px-3 text-sm transition-colors disabled:opacity-50"
          >
            cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col justify-between gap-2">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="border-line hover:border-accent min-h-11 w-full border text-sm transition-colors"
      >
        Drop a file
      </button>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) setPicked(file)
          event.target.value = ''
        }}
      />

      {!configured ? (
        <p className="text-danger text-xs">ZIMADASH_INBOX_ROOT is not set</p>
      ) : recent.length > 0 ? (
        <ul className="space-y-0.5">
          {recent.map((entry) => (
            <li key={entry.id} className="flex items-baseline justify-between gap-2 text-xs">
              <span className="text-ink-dim truncate">{entry.filename}</span>
              <span className={`shrink-0 ${STATUS_TONE[entry.status]}`}>
                {STATUS_TEXT[entry.status]}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export default defineTool({
  meta,
  tier: 'ambient',
  Tile,
  View: InboxView,
  interactiveTile: true,
})
