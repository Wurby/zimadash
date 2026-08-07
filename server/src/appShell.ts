import fs from 'node:fs';
import path from 'node:path';
import { applyShellVariant, slugFromPath, type ShellVariant } from './shared/appShell.js';

/**
 * Serves index.html with the install metadata rewritten for whichever tool the
 * URL points at, so adding /scratch to the home screen installs Scratch rather
 * than the dashboard.
 *
 * The tool list comes from the generated manifests in dist/pwa rather than from
 * a list here — the build already knows every tool, and reading its output
 * keeps this from being a second place to register one.
 */

interface Shell {
  render(pathname: string): string;
}

interface ManifestFile {
  short_name?: string;
  theme_color?: string;
}

export function createAppShell(staticDir: string): Shell {
  const indexPath = path.join(staticDir, 'index.html');
  const pwaDir = path.join(staticDir, 'pwa');

  let html = '';
  const variants = new Map<string, ShellVariant>();

  try {
    html = fs.readFileSync(indexPath, 'utf8');
  } catch {
    // No build yet. render() falls back to sendFile-style behaviour upstream.
  }

  try {
    for (const file of fs.readdirSync(pwaDir)) {
      if (!file.endsWith('.webmanifest')) continue;
      const slug = file.replace(/\.webmanifest$/, '');
      if (slug === 'dash') continue;

      const manifest = JSON.parse(fs.readFileSync(path.join(pwaDir, file), 'utf8')) as ManifestFile;

      variants.set(slug, {
        slug,
        shortName: manifest.short_name ?? slug,
        themeColor: manifest.theme_color ?? '#0f172b',
      });
    }
  } catch {
    // No manifests — every route just gets the dashboard shell.
  }

  return {
    render(pathname: string): string {
      const variant = variants.get(slugFromPath(pathname) ?? '');
      return variant ? applyShellVariant(html, variant) : html;
    },
  };
}
