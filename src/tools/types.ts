import type { ComponentType } from 'react'
import type { RefreshTier } from '@shared/tiers'
import type { SizeBySurface } from '@shared/layout'

/**
 * Static, serialisable facts about a tool. Lives in `meta.json` next to the
 * tool so the build can read it without executing React — that is what lets
 * `scripts/vite-tool-manifests.ts` emit a PWA manifest per tool.
 */
export interface ToolMeta {
  /** URL segment. Must equal the folder name. */
  slug: string
  /** Shown on the tile and in the tool header. */
  name: string
  /** Home-screen name. Keep it short — iOS truncates hard. */
  shortName: string
  /** One line, shown on the tile when there's nothing else to say. */
  description: string
  /** Drives the installed app's theme and the generated icon. */
  themeColor: string
  backgroundColor: string
  /** A single character drawn into the generated icon. */
  glyph: string
  /**
   * How much of the dashboard grid this tool wants, per surface, as
   * [columns, rows]. Omit a surface and it falls back down the ladder to a 4x4
   * square.
   *
   * This is a starting size, not a final one — resizing a tile from the
   * dashboard stores an override for that surface, and the override wins. Pick
   * the size the tool reads best at and let the user disagree.
   */
  size?: SizeBySurface
}

/**
 * What a tool exports. `src/tools/<slug>/tool.tsx` must default-export one of
 * these; the registry picks it up with no central list to edit.
 *
 * A tool must stay extractable — if one outgrows the dash it should lift into
 * its own repo. Never import another tool from inside a tool.
 */
export interface ToolDefinition {
  meta: ToolMeta
  /** How often this tool's data is worth re-fetching. */
  tier: RefreshTier
  /** Rendered on the homepage grid. Should be informative before it's tapped. */
  Tile: ComponentType
  /** Rendered at /<slug>. Free to own sub-routes beneath that. */
  View: ComponentType
  /**
   * The tile takes taps of its own rather than being one big link into the
   * tool.
   *
   * By default a tile is wrapped whole in a link, which is right when the tile
   * is a readout and the tool is where you act. Some tools invert that — the
   * doing is a single tap and belongs on the grid, and the route is where you
   * configure it. Opt in and the title band becomes the way in, leaving the
   * body free; a button inside a link is invalid anyway, and browsers handle it
   * badly.
   *
   * The tile still has to work in edit mode, where the grid makes its contents
   * inert so the cell can be dragged. That is handled for you.
   */
  interactiveTile?: boolean
}

/** Helper so a tool file gets type-checking without repeating the annotation. */
export function defineTool(tool: ToolDefinition): ToolDefinition {
  return tool
}
