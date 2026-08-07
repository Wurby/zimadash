import { useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api'
import { usePolled } from '../../lib/refresh'
import { defineTool } from '../types'
import meta from './meta.json'

/**
 * Scratch — a single shared note, and the reference implementation of the tool
 * contract.
 *
 * It exercises every part of the shape on purpose: its own route, its own tile,
 * its own server namespace (/api/tools/scratch), its own file in DATA_DIR, and
 * the `event-driven` tier. Delete this folder and its server half and nothing
 * else in the app notices — which is the property that matters.
 */

interface Note {
  text: string
  updatedAt: number
}

const SAVE_DEBOUNCE_MS = 700

function useNote() {
  return usePolled('event-driven', () => api<Note>('/api/tools/scratch'))
}

function Tile() {
  const note = useNote()

  if (note.status === 'loading') return <p className="text-ink-dim text-sm">loading…</p>
  if (note.status === 'error') return <p className="text-danger text-sm">{note.message}</p>

  const text = note.data.text.trim()

  if (!text) {
    return <p className="text-ink-dim text-sm italic">Empty — tap to write something.</p>
  }

  return <p className="text-ink-dim line-clamp-4 text-sm whitespace-pre-wrap">{text}</p>
}

function View() {
  const note = useNote()
  const [draft, setDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // The server's copy shows through until you type; from then on the draft owns
  // the field. Deriving it rather than copying it into state on load means a
  // refetch can never yank the cursor out from under you mid-sentence.
  const value = draft ?? (note.status === 'ok' ? note.data.text : '')

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  function edit(text: string) {
    setDraft(text)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      setSaving(true)
      try {
        await api<Note>('/api/tools/scratch', {
          method: 'PUT',
          body: JSON.stringify({ text }),
        })
      } finally {
        setSaving(false)
      }
    }, SAVE_DEBOUNCE_MS)
  }

  if (note.status === 'error') {
    return <p className="text-danger text-sm">could not load the note: {note.message}</p>
  }

  return (
    <div>
      <textarea
        value={value}
        onChange={(event) => edit(event.target.value)}
        disabled={note.status === 'loading'}
        placeholder="Anything you'll want on the other screen…"
        rows={16}
        className="border-line bg-surface focus:border-accent focus:ring-accent/30 w-full resize-y rounded-2xl border p-4 font-mono text-sm outline-none focus:ring-2 disabled:opacity-50"
      />
      <p className="text-ink-dim mt-2 h-4 font-mono text-xs">{saving ? 'saving…' : ''}</p>
    </div>
  )
}

export default defineTool({
  meta,
  tier: 'event-driven',
  Tile,
  View,
})
