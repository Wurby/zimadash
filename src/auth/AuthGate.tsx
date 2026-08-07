import { useEffect, useState, type ReactNode } from 'react'
import { api, ApiError, getToken, setToken, SESSION_EXPIRED_EVENT } from '../lib/api'

type Phase = 'checking' | 'unreachable' | 'setup' | 'login' | 'authed'

const MIN_PIN_LENGTH = 4

const SETUP = '/api/auth/setup'
const LOGIN = '/api/auth/login'

/**
 * Exchange a PIN for a token.
 *
 * Both endpoints answer 409 when the client has the wrong idea about whether a
 * PIN exists yet — setup says "already set", login says "none set". The server
 * is the authority, so follow it and use the other endpoint rather than
 * dead-ending on an error the person typing cannot act on. First use sets the
 * PIN no matter which screen they happened to land on.
 */
async function authenticate(isSetup: boolean, pin: string): Promise<string> {
  const body = JSON.stringify({ pin })

  try {
    const { token } = await api<{ token: string }>(isSetup ? SETUP : LOGIN, {
      method: 'POST',
      body,
    })
    return token
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 409) throw err

    const { token } = await api<{ token: string }>(isSetup ? LOGIN : SETUP, {
      method: 'POST',
      body,
    })
    return token
  }
}

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
        // Unreachable is not the same as "a PIN already exists". Guessing that
        // it does is what strands a first-ever visit behind a login form it can
        // never satisfy, so say what actually happened and offer a retry.
        if (!cancelled) setPhase('unreachable')
      })

    return () => {
      cancelled = true
    }
  }, [phase])

  useEffect(() => {
    function onExpired() {
      setPin('')
      setError('your session ended — enter your PIN')
      // Back to 'checking', not straight to 'login' — the server is the
      // authority on which screen this should be.
      setPhase('checking')
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
      setToken(await authenticate(phase === 'setup', pin))
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

  if (phase === 'unreachable') {
    return (
      <div className="grid min-h-dvh place-items-center p-6">
        <div className="border-line bg-surface w-full max-w-sm border p-6 text-center shadow-sm sm:p-8">
          <h1 className="text-xl font-semibold tracking-tight">zimadash</h1>
          <p className="text-ink-dim mt-2 text-sm">Can't reach the dashboard server.</p>
          <button
            type="button"
            onClick={() => {
              setError(null)
              setPhase('checking')
            }}
            className="bg-accent mt-6 w-full px-4 py-2.5 font-medium text-slate-50 transition-opacity dark:text-slate-900 hover:opacity-90"
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  const isSetup = phase === 'setup'

  return (
    <div className="grid min-h-dvh place-items-center p-6">
      <form
        onSubmit={submit}
        className="border-line bg-surface w-full max-w-sm border p-6 shadow-sm sm:p-8"
      >
        <h1 className="text-xl font-semibold tracking-tight">zimadash</h1>
        <p className="text-ink-dim mt-1 text-sm">{isSetup ? 'Choose a PIN.' : 'Enter your PIN.'}</p>

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
            className="border-line focus:border-accent focus:ring-accent/30 mt-1.5 w-full border bg-transparent px-3 py-2.5 font-mono text-lg tracking-widest outline-none focus:ring-2"
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
          className="bg-accent mt-6 w-full px-4 py-2.5 font-medium text-slate-50 transition-opacity dark:text-slate-900 hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'working…' : isSetup ? 'Set PIN' : 'Unlock'}
        </button>
      </form>
    </div>
  )
}
