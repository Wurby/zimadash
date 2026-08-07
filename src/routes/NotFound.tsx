import { Link, useLocation } from 'react-router'
import { Icon } from '../components/Icon'

export function NotFound() {
  const { pathname } = useLocation()

  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
      <div className="border-line border border-dashed p-10 text-center">
        <p className="text-lg font-semibold tracking-tight">No tool here</p>
        <p className="text-ink-dim mt-2 font-mono text-sm break-all">{pathname}</p>
        <Link
          to="/"
          className="border-line hover:border-accent mt-6 inline-flex items-center gap-2 border px-3 py-2 text-sm font-medium transition-colors"
        >
          <Icon name="back" />
          Back to the dashboard
        </Link>
      </div>
    </main>
  )
}
