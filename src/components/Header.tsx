import { Link } from 'react-router'
import { useTheme } from '../lib/theme'
import { Icon } from './Icon'
import { QuickActions } from './QuickActions'
import { StatsPanel } from './StatsPanel'

/**
 * The header is actions, not navigation.
 *
 * Theme toggle, one-tap actions, and the system-stats panel. Getting back to
 * the homepage is the back arrow inside each tool, not a nav bar up here — the
 * wordmark links home as a convenience, nothing more.
 */
export function Header() {
  const { theme, toggle } = useTheme()

  return (
    <header className="border-line bg-bg/80 sticky top-0 z-30 border-b backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-3 p-3 sm:px-6">
        <Link
          to="/"
          className="hover:text-accent text-base font-semibold tracking-tight transition-colors"
        >
          zimadash
        </Link>

        <div className="ml-auto flex items-center gap-2">
          <QuickActions />
          <StatsPanel />
          <button
            type="button"
            onClick={toggle}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            className="border-line hover:border-accent rounded-lg border p-1.5 transition-colors"
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>
        </div>
      </div>
    </header>
  )
}
