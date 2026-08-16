import { useState } from 'react'
import { MAX_INSTRUCTIONS, type InboxEntry } from '@shared/inbox'
import { usePolled } from '../../lib/refresh'
import { dismissEntry, getInbox, uploadFile } from './api'

/**
 * The route behind the tile: the audit surface.
 *
 * The tile does the uploading; this is where "no silent failure" is actually
 * checkable — every settled entry, what it decided, and why, so a fire-and-
 * forget upload never has to be taken on faith.
 */

const TOUCH = 'min-h-11'

const STATUS_TONE: Record<InboxEntry['status'], string> = {
  working: 'text-ink-dim',
  placed: 'text-accent',
  unsorted: 'text-amber-700 dark:text-amber-400',
  failed: 'text-danger',
}

function relativeTime(at: number): string {
  const seconds = Math.round((Date.now() - at) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function Row({ entry, onDismiss }: { entry: InboxEntry; onDismiss: () => Promise<void> }) {
  return (
    <li className="border-line bg-surface border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{entry.filename}</p>
          {entry.destination && (
            <p className="text-ink-dim mt-0.5 truncate font-mono text-xs">{entry.destination}</p>
          )}
        </div>
        <span className={`shrink-0 text-xs font-medium ${STATUS_TONE[entry.status]}`}>
          {entry.status}
        </span>
      </div>

      {(entry.reasoning || entry.reason) && (
        <p className="text-ink-dim mt-2 text-xs">{entry.reason || entry.reasoning}</p>
      )}

      <div className="mt-2 flex items-center justify-between">
        <span className="text-ink-dim font-mono text-[0.65rem]">{relativeTime(entry.at)}</span>
        {entry.status !== 'working' && (
          <button
            type="button"
            onClick={() => void onDismiss()}
            className={`border-line text-ink-dim hover:border-danger hover:text-danger ${TOUCH} border px-2 text-xs transition-colors`}
          >
            dismiss
          </button>
        )}
      </div>
    </li>
  )
}

export function InboxView() {
  const state = usePolled('ambient', getInbox)
  const [instructions, setInstructions] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const configured = state.status === 'ok' ? state.data.configured : true
  const entries = state.status === 'ok' ? state.data.entries : []

  async function send(file: File) {
    setSending(true)
    setError(null)
    try {
      await uploadFile(file, instructions.trim())
      setInstructions('')
      state.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'upload failed')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-6">
      {!configured && (
        <p className="border-danger text-danger border p-3 text-sm">
          ZIMADASH_INBOX_ROOT is not set on the server — uploads will fail until it is.
        </p>
      )}

      <section>
        <h2 className="text-sm font-semibold tracking-tight">Drop a file</h2>
        <p className="text-ink-dim mt-1 text-xs">
          Optional instructions steer the brain; leave it blank and it decides from the file alone.
        </p>

        <div className="mt-3 space-y-2">
          <textarea
            value={instructions}
            maxLength={MAX_INSTRUCTIONS}
            onChange={(event) => setInstructions(event.target.value)}
            placeholder="e.g. this is Ella's mission farewell talk"
            rows={2}
            className="border-line focus:border-accent w-full border bg-transparent p-2 text-sm outline-none"
          />
          <label
            className={`border-accent text-accent hover:bg-accent/10 ${TOUCH} inline-flex cursor-pointer items-center border px-4 text-sm transition-colors ${
              sending ? 'pointer-events-none opacity-50' : ''
            }`}
          >
            {sending ? 'sending…' : 'choose a file'}
            <input
              type="file"
              className="hidden"
              disabled={sending}
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file) void send(file)
              }}
            />
          </label>
        </div>

        {error && <p className="text-danger mt-2 text-xs">{error}</p>}
      </section>

      <section>
        <h2 className="text-sm font-semibold tracking-tight">Recent</h2>

        {state.status === 'loading' && <p className="text-ink-dim mt-3 text-sm">loading…</p>}
        {state.status === 'error' && <p className="text-danger mt-3 text-sm">{state.message}</p>}
        {state.status === 'ok' && entries.length === 0 && (
          <p className="text-ink-dim mt-3 text-sm italic">Nothing uploaded yet.</p>
        )}

        <ul className="mt-3 space-y-2">
          {entries.map((entry) => (
            <Row
              key={entry.id}
              entry={entry}
              onDismiss={async () => {
                await dismissEntry(entry.id)
                state.refresh()
              }}
            />
          ))}
        </ul>
      </section>
    </div>
  )
}
