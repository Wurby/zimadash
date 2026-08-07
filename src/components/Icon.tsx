import type { ReactNode } from 'react'

/**
 * A small hand-rolled icon set. Stroke-based and sized in `em` so an icon
 * always matches the text it sits beside, and inherits `currentColor` so it
 * works in both themes without a second asset.
 */

const paths: Record<string, ReactNode> = {
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
    </>
  ),
  moon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />,
  back: <path d="M19 12H5M12 19l-7-7 7-7" />,
  check: <path d="M20 6L9 17l-5-5" />,
  bolt: <path d="M13 2L4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5z" />,
  activity: <path d="M3 12h4l3 8 4-16 3 8h4" />,
  note: (
    <>
      <path d="M4 4h16v12l-4 4H4z" />
      <path d="M20 16h-4v4" />
    </>
  ),
  chevron: <path d="M6 9l6 6 6-6" />,
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
}

export type IconName = keyof typeof paths

export function Icon({ name, className = '' }: { name: string; className?: string }) {
  const path = paths[name] ?? paths.bolt
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`h-[1.25em] w-[1.25em] ${className}`}
    >
      {path}
    </svg>
  )
}
