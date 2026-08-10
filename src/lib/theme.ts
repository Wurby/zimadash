import { useCallback, useSyncExternalStore } from 'react'

/**
 * Light, dark, or whatever the OS says.
 *
 * Two things are tracked and they are not the same: the **preference**, which
 * is what you chose and what gets stored, and the **resolved** theme, which is
 * what is actually on screen. In system mode the preference stays `system`
 * while the resolved value flips underneath it.
 *
 * The class on `<html>` is the resolved one, seeded by the inline script in
 * index.html before first paint so the wall display never flashes the wrong
 * theme. This module is only what happens after that.
 *
 * Absence of the stored key means system. That keeps one meaning for one state
 * — a first visit and a deliberate "follow the OS" are the same thing, and the
 * seed script doesn't need to know about a third value.
 */

const STORAGE_KEY = 'zimadash.theme'

export type Theme = 'light' | 'dark' | 'system'
export type Resolved = 'light' | 'dark'

/** What the button steps through, in order. */
const ORDER: Theme[] = ['light', 'dark', 'system']

const listeners = new Set<() => void>()
const query = window.matchMedia('(prefers-color-scheme: dark)')

function read(): Theme {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch {
    // Private browsing. The choice still works for this session.
    return 'system'
  }
}

let preference: Theme = read()

function resolve(theme: Theme): Resolved {
  if (theme !== 'system') return theme
  return query.matches ? 'dark' : 'light'
}

function apply(): void {
  document.documentElement.classList.toggle('dark', resolve(preference) === 'dark')
  for (const listener of listeners) listener()
}

// The OS can change under us — on a schedule, usually — and in system mode that
// has to land without a reload. The wall display goes untouched for days, so a
// change it only picks up on next visit is a change it never picks up.
query.addEventListener('change', () => {
  if (preference === 'system') apply()
})

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setTheme(theme: Theme): void {
  preference = theme
  try {
    // Stored only when pinned. A pinned value also holds against later OS
    // changes, which is the point of pinning it.
    if (theme === 'system') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    /* private browsing — the choice still works for this session */
  }
  apply()
}

export function nextTheme(theme: Theme): Theme {
  return ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length]
}

export function useTheme(): {
  /** What you chose. `system` means it follows the OS. */
  theme: Theme
  /** What is actually on screen right now. */
  resolved: Resolved
  cycle: () => void
} {
  // Two subscriptions rather than one returning an object: each snapshot has to
  // be referentially stable between renders, and a fresh object never is.
  const theme = useSyncExternalStore(
    subscribe,
    () => preference,
    () => 'system' as Theme,
  )
  const resolved = useSyncExternalStore(
    subscribe,
    () => resolve(preference),
    () => 'light' as Resolved,
  )

  const cycle = useCallback(() => setTheme(nextTheme(preference)), [])

  return { theme, resolved, cycle }
}
