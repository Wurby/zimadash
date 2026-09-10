import { useState } from 'react'
import { api, setPinLength } from '../lib/api'
import { Icon } from './Icon'

/**
 * Change this PIN, or add someone else's. Lives on the grid with the theme
 * toggle — there is no header to hang it off, and a tool is the wrong place
 * for house chrome.
 */

const TOUCH = 'min-h-11'

export function AccountButton() {
  const [open, setOpen] = useState(false)
  const [pin, setPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [busy, setBusy] = useState<'pin' | 'user' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  function close() {
    setOpen(false)
    setPin('')
    setNewPin('')
    setError(null)
    setNotice(null)
    setBusy(null)
  }

  async function changePin(event: React.FormEvent) {
    event.preventDefault()
    if (pin.length < 4 || busy) return
    setBusy('pin')
    setError(null)
    setNotice(null)
    try {
      await api('/api/auth/pin', { method: 'PUT', body: JSON.stringify({ pin }) })
      setPinLength(pin.length)
      setPin('')
      setNotice('PIN changed')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'that did not work')
    } finally {
      setBusy(null)
    }
  }

  async function addUser(event: React.FormEvent) {
    event.preventDefault()
    if (newPin.length < 4 || busy) return
    setBusy('user')
    setError(null)
    setNotice(null)
    try {
      await api('/api/auth/users', { method: 'POST', body: JSON.stringify({ pin: newPin }) })
      setNewPin('')
      setNotice('PIN added')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'that did not work')
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Account: change PIN or add a user"
        className="border-line bg-surface hover:border-accent grid h-full w-full place-items-center border transition-colors"
      >
        <Icon name="user" />
      </button>

      {open && (
        <div className="fixed inset-0 z-30 flex items-start justify-center px-6 pt-16 pb-6 sm:items-center sm:pt-6">
          <button
            type="button"
            aria-label="Close"
            onClick={close}
            className="bg-bg/80 absolute inset-0"
          />
          <div className="border-line bg-surface relative z-10 w-full max-w-sm border p-6 shadow-sm sm:p-8">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-xl font-semibold tracking-tight">Account</h2>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className={`border-line hover:border-accent ${TOUCH} w-11 border`}
              >
                ✕
              </button>
            </div>

            <form onSubmit={changePin} className="mt-6">
              <label className="block">
                <span className="text-ink-dim block text-xs font-medium tracking-wide uppercase">
                  Change my PIN
                </span>
                <input
                  type="password"
                  value={pin}
                  onChange={(event) => setPin(event.target.value)}
                  autoComplete="new-password"
                  className="border-line focus:border-accent focus:ring-accent/30 mt-1.5 w-full border bg-transparent px-3 py-2.5 font-mono text-lg tracking-widest outline-none focus:ring-2"
                />
              </label>
              <button
                type="submit"
                disabled={busy !== null || pin.length < 4}
                className={`bg-accent mt-3 w-full px-4 py-2.5 font-medium text-slate-50 transition-opacity dark:text-slate-900 hover:opacity-90 disabled:opacity-50 ${TOUCH}`}
              >
                {busy === 'pin' ? 'saving…' : 'Save PIN'}
              </button>
            </form>

            <form onSubmit={addUser} className="mt-8">
              <label className="block">
                <span className="text-ink-dim block text-xs font-medium tracking-wide uppercase">
                  Add a user
                </span>
                <input
                  type="password"
                  value={newPin}
                  onChange={(event) => setNewPin(event.target.value)}
                  autoComplete="new-password"
                  className="border-line focus:border-accent focus:ring-accent/30 mt-1.5 w-full border bg-transparent px-3 py-2.5 font-mono text-lg tracking-widest outline-none focus:ring-2"
                />
              </label>
              <p className="text-ink-dim mt-1.5 text-xs">Their PIN. They can change it later.</p>
              <button
                type="submit"
                disabled={busy !== null || newPin.length < 4}
                className={`border-accent text-accent hover:bg-accent/10 mt-3 w-full border px-4 py-2.5 text-sm transition-colors disabled:opacity-50 ${TOUCH}`}
              >
                {busy === 'user' ? 'adding…' : 'Add PIN'}
              </button>
            </form>

            {notice && <p className="text-accent mt-4 text-sm">{notice}</p>}
            {error && (
              <p role="alert" className="text-danger mt-4 text-sm">
                {error}
              </p>
            )}
          </div>
        </div>
      )}
    </>
  )
}
