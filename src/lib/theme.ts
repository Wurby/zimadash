import { useCallback, useSyncExternalStore } from 'react'

/**
 * Light/dark, class-driven on <html>. The inline script in index.html seeds the
 * class before first paint so the wall display never flashes the wrong theme;
 * this module is only what happens after a tap.
 */

const STORAGE_KEY = 'zimadash.theme'

export type Theme = 'light' | 'dark'

const listeners = new Set<() => void>()

function isDark(): boolean {
  return document.documentElement.classList.contains('dark')
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function snapshot(): Theme {
  return isDark() ? 'dark' : 'light'
}

export function setTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  // A stored value also pins the choice against later OS changes, which is what
  // you want on a display that lives on a wall.
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    /* private browsing — the toggle still works for this session */
  }
  for (const listener of listeners) listener()
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  const theme = useSyncExternalStore(subscribe, snapshot, () => 'light' as Theme)
  const toggle = useCallback(() => {
    setTheme(snapshot() === 'dark' ? 'light' : 'dark')
  }, [])
  return { theme, toggle }
}
