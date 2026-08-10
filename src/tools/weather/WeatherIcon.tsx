import type { ReactNode } from 'react'

/**
 * The tool's own icon set.
 *
 * These live with the tool rather than in `components/Icon.tsx` because a tool
 * has to stay liftable into its own repo, and nothing outside weather has any
 * use for a rain cloud. Same conventions as the shared set: stroke-based, sized
 * in `em` so it matches the text beside it, and `currentColor` so one asset
 * covers both themes.
 */

const CLOUD = 'M7.5 19h9.5a3.5 3.5 0 0 0 .3-7 5.5 5.5 0 0 0-10.5-1.2A4 4 0 0 0 7.5 19z'

const paths: Record<string, ReactNode> = {
  clear: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
    </>
  ),
  'clear-night': <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />,
  partly: (
    <>
      <path d="M8 5.5V4M4.4 7.1L3.3 6M12 9.4V8M5.1 12H3.6M4.4 15.4L3.3 16.5" />
      <circle cx="8" cy="9.5" r="2.6" />
      <path d={CLOUD} />
    </>
  ),
  cloud: <path d={CLOUD} />,
  fog: (
    <>
      <path d="M5 15.5h14M4 19h9M8 12h12" />
      <path d="M6.5 8.5a5.5 5.5 0 0 1 10.7-1.3" />
    </>
  ),
  drizzle: (
    <>
      <path d={CLOUD} />
      <path d="M9 21v1M13 21v1" />
    </>
  ),
  rain: (
    <>
      <path d={CLOUD} />
      <path d="M8.5 20.5l-1 2.5M12.5 20.5l-1 2.5M16.5 20.5l-1 2.5" />
    </>
  ),
  snow: (
    <>
      <path d={CLOUD} />
      <path d="M9 21.5h.01M13 21.5h.01M11 23.5h.01" />
    </>
  ),
  storm: (
    <>
      <path d={CLOUD} />
      <path d="M13 20l-3 2.5h3L10 25" />
    </>
  ),
}

export function WeatherIcon({ name, className = '' }: { name: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 26"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`h-[1.25em] w-[1.25em] ${className}`}
    >
      {paths[name] ?? paths.cloud}
    </svg>
  )
}
