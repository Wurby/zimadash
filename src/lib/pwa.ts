import { useEffect } from 'react'

/**
 * Keep the shell's install metadata pointing at whatever you're looking at.
 *
 * The server (and the Vite dev middleware) already deliver the right tags for
 * the URL that was requested — which is what actually makes "Add to Home
 * Screen" install a tool rather than the dashboard, because Safari reads them
 * from the document as delivered and ignores later changes.
 *
 * This exists for the other half: a client-side navigation never re-fetches
 * the document, so without it the tags would still describe whichever page you
 * happened to load first.
 */

interface Pwa {
  slug: string | null
  shortName: string
  themeColor: string
}

const DASH: Pwa = { slug: null, shortName: 'zimadash', themeColor: '#0f172b' }

function setMeta(name: string, content: string): string | null {
  const meta = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)
  if (!meta) return null
  const previous = meta.getAttribute('content')
  meta.setAttribute('content', content)
  return previous
}

function setLink(rel: string, href: string): string | null {
  let link = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`)
  if (!link) {
    link = document.createElement('link')
    link.rel = rel
    document.head.appendChild(link)
  }
  const previous = link.getAttribute('href')
  link.setAttribute('href', href)
  return previous
}

export function usePwaManifest(slug: string | null, shortName?: string, themeColor?: string): void {
  const name = shortName ?? DASH.shortName
  const color = themeColor ?? DASH.themeColor

  useEffect(() => {
    const key = slug ?? 'dash'

    const previous = {
      manifest: setLink('manifest', `/pwa/${key}.webmanifest`),
      icon: setLink('apple-touch-icon', `/pwa/${key}-icon.svg`),
      theme: setMeta('theme-color', color),
      title: setMeta('apple-mobile-web-app-title', name),
      documentTitle: document.title,
    }
    document.title = name

    return () => {
      if (previous.manifest) setLink('manifest', previous.manifest)
      if (previous.icon) setLink('apple-touch-icon', previous.icon)
      if (previous.theme) setMeta('theme-color', previous.theme)
      if (previous.title) setMeta('apple-mobile-web-app-title', previous.title)
      document.title = previous.documentTitle
    }
  }, [slug, name, color])
}
