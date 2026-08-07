const TOKEN_KEY = 'zimadash.token'

/** Fired when the server rejects our token. The auth gate listens and drops
 *  back to the PIN screen. */
export const SESSION_EXPIRED_EVENT = 'zimadash:session-expired'

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token)
  } catch {
    /* private browsing — the session just won't persist */
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* nothing to clear */
  }
}

export class ApiError extends Error {
  status: number
  body: Record<string, unknown>

  constructor(message: string, status: number, body: Record<string, unknown> = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

/**
 * Every call to our own API goes through here so the token is attached in one
 * place and a rejected session is handled in one place.
 */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken()
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  if (init.body) headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const res = await fetch(path, { ...init, headers })
  const body = await res.json().catch(() => ({}) as Record<string, unknown>)

  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    clearToken()
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
  }

  if (!res.ok) {
    const message = typeof body.error === 'string' ? body.error : res.statusText
    throw new ApiError(message, res.status, body)
  }

  return body as T
}
