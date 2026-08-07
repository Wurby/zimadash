import { useTheme } from '../lib/theme'
import { Icon } from './Icon'
import { QuickActions } from './QuickActions'
import { StatsPanel } from './StatsPanel'

/**
 * The header is actions, not navigation.
 *
 * It is laid out on a two-row grid of square cells. An action is 1x1
 * (`size-10`); the stats badge is 2x2 — two cells plus the gap between them,
 * which is `size-22` exactly (2 × 2.5rem + 0.5rem = 5.5rem). Both columns come
 * out the same height, so the header is two rows tall with nothing to align by
 * hand. Change one and the other has to follow.
 *
 * Actions flow down each column before starting the next, so a growing
 * actions.json fills right to left toward the badge rather than pushing the
 * header wider on a phone.
 *
 * Getting back to the homepage is the back arrow inside each tool — there is
 * deliberately no nav here.
 */
export function Header() {
  const { theme, toggle } = useTheme()

  return (
    <header className="border-line bg-bg/80 sticky top-0 z-30 border-b backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-start gap-3 p-3 sm:px-6">
        <StatsPanel />

        <nav className="ml-auto grid grid-flow-col grid-rows-2 gap-2" aria-label="Quick actions">
          <QuickActions />
          <button
            type="button"
            onClick={toggle}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            className="border-line bg-surface hover:border-accent grid size-10 place-items-center border transition-colors"
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>
        </nav>
      </div>
    </header>
  )
}
