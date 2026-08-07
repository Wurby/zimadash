/**
 * The ZD monogram.
 *
 * Letters are knocked out in the page background rather than white, so the mark
 * keeps full contrast in both themes — the accent is a mid blue in light and a
 * lighter blue in dark, and white would go muddy against the latter.
 *
 * Carries no size of its own: pass one, or it inherits the SVG default. Baking
 * a default in would only fight the caller's class for the same specificity.
 */
export function Logo({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`shrink-0 ${className}`}>
      <rect className="fill-accent" width="24" height="24" rx="6.5" />
      <g
        className="stroke-bg"
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* Z */}
        <path d="M5.75 8h4.5l-4.5 8h4.5" />
        {/* D */}
        <path d="M13.75 8v8M13.75 8h1.4a4 4 0 0 1 0 8h-1.4" />
      </g>
    </svg>
  )
}
