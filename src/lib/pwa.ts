import { useEffect } from 'react'

/**
 * Point the page at the right web app manifest for whatever you're looking at.
 *
 * Each tool is its own installable PWA with a distinct icon and start_url, so
 * a single tool can live on the phone home screen on its own. Installing
 * happens against whatever manifest is linked at that moment — so the link has
 * to follow the route.
 *
 * The manifests themselves are generated at build time from each tool's
 * meta.json by scripts/vite-tool-manifests.ts.
 */
export function usePwaManifest(slug: string | null, themeColor?: string): void {
  useEffect(() => {
    const href = `/pwa/${slug ?? 'dash'}.webmanifest`

    let link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')
    if (!link) {
      link = document.createElement('link')
      link.rel = 'manifest'
      document.head.appendChild(link)
    }
    const previous = link.getAttribute('href')
    link.setAttribute('href', href)

    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    const previousColor = meta?.getAttribute('content') ?? null
    if (meta && themeColor) meta.setAttribute('content', themeColor)

    return () => {
      if (previous) link.setAttribute('href', previous)
      if (meta && previousColor) meta.setAttribute('content', previousColor)
    }
  }, [slug, themeColor])
}
