import { useTheme } from '../lib/theme'
import { Icon } from './Icon'
import { QuickActions } from './QuickActions'
import { StatsPanel } from './StatsPanel'

/**
 * The header is actions, not navigation.
 *
 * The ZD badge on the left is the wordmark and the system-stats control at
 * once — the monitoring was never the point, so it gets a glance-able readout
 * and nothing more until you ask for it. Getting back to the homepage is the
 * back arrow inside each tool, so there is deliberately no nav here.
 */
export function Header() {
  const { theme, toggle } = useTheme()

  return (
    <header className="border-line bg-bg/80 sticky top-0 z-30 border-b backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-3 p-3 sm:px-6">
        <StatsPanel />

        <div className="ml-auto flex items-center gap-2">
          <QuickActions />
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
