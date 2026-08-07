/**
 * Per-tool rewriting of the app shell's install metadata.
 *
 * "Add to Home Screen" reads the manifest link, the apple-touch-icon, and the
 * title from the document **as delivered**. Swapping them from React afterwards
 * is too late — Safari has already decided what it is installing. So the HTML
 * has to arrive correct for whatever URL was requested.
 *
 * Used by both the production server and the Vite dev middleware, so a tool
 * installs the same way in either. Pure string work — no Node built-ins, so it
 * can live in shared/.
 */

export interface ShellVariant {
  slug: string;
  shortName: string;
  themeColor: string;
}

/** First path segment, which is a tool slug if it is anything. */
export function slugFromPath(pathname: string): string | null {
  return pathname.split('/')[1] || null;
}

function replaceMetaContent(html: string, name: string, value: string): string {
  const pattern = new RegExp(`(<meta name="${name}" content=")[^"]*(")`);
  return html.replace(pattern, `$1${value}$2`);
}

export function applyShellVariant(html: string, variant: ShellVariant): string {
  const withLinks = html
    .replace('/pwa/dash.webmanifest', `/pwa/${variant.slug}.webmanifest`)
    .replace('/pwa/dash-icon.svg', `/pwa/${variant.slug}-icon.svg`)
    .replace(/(<title>)[^<]*(<\/title>)/, `$1${variant.shortName}$2`);

  return replaceMetaContent(
    replaceMetaContent(withLinks, 'theme-color', variant.themeColor),
    'apple-mobile-web-app-title',
    variant.shortName,
  );
}
