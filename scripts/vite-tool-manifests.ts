import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

/**
 * Emit a web app manifest and an icon per tool, so each tool installs to the
 * home screen as its own app with its own name, icon, and start_url.
 *
 * Tool metadata is read from `src/tools/<slug>/meta.json` rather than from the
 * tool module, because generating these at build time means never executing
 * React to find out what a tool is called.
 *
 * Output lands at /pwa/<slug>.webmanifest, with /pwa/dash.webmanifest for the
 * dashboard itself. src/lib/pwa.ts swaps the <link> as you navigate.
 */

const TOOLS_DIR = fileURLToPath(new URL('../src/tools', import.meta.url))

interface ToolMeta {
  slug: string
  name: string
  shortName: string
  description: string
  themeColor: string
  backgroundColor: string
  glyph: string
}

const DASH: ToolMeta = {
  slug: 'dash',
  name: 'zimadash',
  shortName: 'zimadash',
  description: 'A personal dashboard',
  themeColor: '#1b1d21',
  backgroundColor: '#ffffff',
  glyph: '◆',
}

function readToolMeta(): ToolMeta[] {
  if (!fs.existsSync(TOOLS_DIR)) return []

  return fs
    .readdirSync(TOOLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(TOOLS_DIR, entry.name, 'meta.json'))
    .filter((file) => fs.existsSync(file))
    .map((file) => JSON.parse(fs.readFileSync(file, 'utf8')) as ToolMeta)
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * A generated icon: the tool's color with its glyph centered. Deliberately
 * plain — it exists so a tool is installable before anyone draws real art, and
 * the safe zone is kept clear so the maskable crop can't clip the glyph.
 */
function iconSvg(meta: ToolMeta): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" rx="96" fill="${escapeXml(meta.themeColor)}"/>
  <text x="50%" y="50%" dy="0.35em" text-anchor="middle"
        font-family="ui-sans-serif, system-ui, -apple-system, sans-serif"
        font-size="256" fill="#ffffff">${escapeXml(meta.glyph)}</text>
</svg>
`
}

function manifestJson(meta: ToolMeta): string {
  const isDash = meta.slug === DASH.slug
  return `${JSON.stringify(
    {
      id: `/${isDash ? '' : meta.slug}`,
      name: isDash ? meta.name : `${meta.name} · zimadash`,
      short_name: meta.shortName,
      description: meta.description,
      start_url: `/${isDash ? '' : meta.slug}`,
      scope: '/',
      display: 'standalone',
      orientation: 'any',
      theme_color: meta.themeColor,
      background_color: meta.backgroundColor,
      icons: [
        {
          src: `/pwa/${meta.slug}-icon.svg`,
          sizes: 'any',
          type: 'image/svg+xml',
          purpose: 'any maskable',
        },
      ],
    },
    null,
    2,
  )}\n`
}

function filesFor(all: ToolMeta[]): Map<string, { body: string; type: string }> {
  const files = new Map<string, { body: string; type: string }>()

  for (const meta of [DASH, ...all]) {
    files.set(`pwa/${meta.slug}.webmanifest`, {
      body: manifestJson(meta),
      type: 'application/manifest+json',
    })
    files.set(`pwa/${meta.slug}-icon.svg`, {
      body: iconSvg(meta),
      type: 'image/svg+xml',
    })
  }

  return files
}

export function toolManifests(): Plugin {
  return {
    name: 'zimadash:tool-manifests',

    // Read fresh on every request in dev so adding a tool doesn't need a restart.
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0]
        if (!url?.startsWith('/pwa/')) return next()

        const file = filesFor(readToolMeta()).get(url.slice(1))
        if (!file) return next()

        res.setHeader('Content-Type', file.type)
        res.end(file.body)
      })
    },

    generateBundle() {
      for (const [fileName, file] of filesFor(readToolMeta())) {
        this.emitFile({ type: 'asset', fileName, source: file.body })
      }
    },
  }
}
