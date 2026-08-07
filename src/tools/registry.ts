import type { ToolDefinition } from './types'

/**
 * Convention-driven registration. Drop a folder in `src/tools/<slug>/` with a
 * `tool.tsx` that default-exports a ToolDefinition, and it appears on the
 * homepage and gets a route. There is no central list to edit.
 *
 * Eager so the homepage can render every tile on first paint — tiles show live
 * data at rest, so lazy-loading them would only trade a blank grid for a
 * slightly smaller bundle. Revisit if a tool ever gets genuinely heavy.
 */
const modules = import.meta.glob<{ default: ToolDefinition }>('./*/tool.tsx', {
  eager: true,
})

function slugFromPath(path: string): string {
  // './scratch/tool.tsx' -> 'scratch'
  return path.split('/')[1]
}

export const tools: ToolDefinition[] = Object.entries(modules)
  .map(([path, mod]) => {
    const tool = mod.default
    const folder = slugFromPath(path)

    if (!tool) {
      throw new Error(`${path} has no default export — expected a ToolDefinition`)
    }
    // A mismatch here would route to one URL while the manifest advertised
    // another, so fail loudly at startup rather than shipping a broken install.
    if (tool.meta.slug !== folder) {
      throw new Error(
        `tool slug "${tool.meta.slug}" does not match its folder "${folder}" (${path})`,
      )
    }
    return tool
  })
  .sort((a, b) => a.meta.name.localeCompare(b.meta.name))

export function findTool(slug: string | undefined): ToolDefinition | undefined {
  return tools.find((tool) => tool.meta.slug === slug)
}
