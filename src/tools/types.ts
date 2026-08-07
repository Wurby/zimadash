import type { ComponentType } from 'react'
import type { RefreshTier } from '@shared/tiers'

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
}

/** Helper so a tool file gets type-checking without repeating the annotation. */
export function defineTool(tool: ToolDefinition): ToolDefinition {
  return tool
}
