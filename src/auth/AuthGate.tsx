import { useEffect, useState, type ReactNode } from 'react'
import { api, getToken, setToken, SESSION_EXPIRED_EVENT } from '../lib/api'

type Phase = 'checking' | 'setup' | 'login' | 'authed'

const MIN_PIN_LENGTH = 4

export function AuthGate({ children }: { children: ReactNode }) {
  // A token already in storage is taken at face value; the first rejected API
  // call bounces us back here via SESSION_EXPIRED_EVENT.
  const [phase, setPhase] = useState<Phase>(() => (getToken() ? 'authed' : 'checking'))
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Without a token we have to ask the server whether a PIN exists yet, to know
  // if this is a first-ever visit or a normal unlock.
  useEffect(() => {
    if (phase !== 'checking') return

    let cancelled = false
    api<{ configured: boolean }>('/api/auth/status')
      .then(({ configured }) => {
        if (!cancelled) setPhase(configured ? 'login' : 'setup')
      })
      .catch(() => {
        if (cancelled) return
        setError('cannot reach the dashboard server')
        setPhase('login')
      })

    return () => {
      cancelled = true
    }
  }, [phase])

  useEffect(() => {
    function onExpired() {
      setPin('')
      setError('your session ended — enter your PIN')
      setPhase('login')
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired)
  }, [])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)

    if (pin.length < MIN_PIN_LENGTH) {
      setError(`pin must be at least ${MIN_PIN_LENGTH} characters`)
      return
    }

    setBusy(true)
    try {
      const endpoint = phase === 'setup' ? '/api/auth/setup' : '/api/auth/login'
      const { token } = await api<{ token: string }>(endpoint, {
        method: 'POST',
        body: JSON.stringify({ pin }),
      })
      setToken(token)
      setPin('')
      setPhase('authed')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'something went wrong')
    } finally {
      setBusy(false)
    }
  }

  if (phase === 'authed') return <>{children}</>

  if (phase === 'checking') {
    return (
      <div className="grid min-h-dvh place-items-center">
        <p className="text-ink-dim text-sm">loading…</p>
      </div>
    )
  }

  const isSetup = phase === 'setup'

  return (
    <div className="grid min-h-dvh place-items-center p-6">
      <form
        onSubmit={submit}
        className="border-line bg-surface w-full max-w-sm rounded-2xl border p-6 shadow-sm sm:p-8"
      >
        <h1 className="text-xl font-semibold tracking-tight">zimadash</h1>
        <p className="text-ink-dim mt-1 text-sm">
          {isSetup ? 'Choose a PIN.' : 'Enter your PIN.'}
        </p>

        {/* There is only ever one user, but password managers and screen
            readers expect a username field alongside a password field. */}
        <input
          type="text"
          name="username"
          value="zimadash"
          autoComplete="username"
          readOnly
          hidden
          aria-hidden="true"
        />

        <label className="mt-6 block">
          <span className="text-ink-dim text-xs font-medium tracking-wide uppercase">PIN</span>
          <input
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            autoFocus
            autoComplete={isSetup ? 'new-password' : 'current-password'}
            className="border-line focus:border-accent focus:ring-accent/30 mt-1.5 w-full rounded-lg border bg-transparent px-3 py-2.5 font-mono text-lg tracking-widest outline-none focus:ring-2"
          />
        </label>

        {error && (
          <p role="alert" className="text-danger mt-4 text-sm">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="bg-accent mt-6 w-full rounded-lg px-4 py-2.5 font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'working…' : isSetup ? 'Set PIN' : 'Unlock'}
        </button>
      </form>
    </div>
  )
}
