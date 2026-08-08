/**
 * The dashboard grid, shared by both sides.
 *
 * Sizes are spans, not pixels. The column count steps by surface and the unit
 * is derived to fill the width, so a 3x3 tile is always exactly three actions
 * wide however big an action happens to be on that screen — 38px on a phone,
 * around 59px on a wall-mounted tablet. The ratios are the design; the
 * pixels are a consequence.
 */

export type Breakpoint = 'sm' | 'md' | 'lg';

/** Columns per surface. Below 640 is a phone, below 1024 a portrait tablet. */
export const COLUMNS: Record<Breakpoint, number> = { sm: 8, md: 12, lg: 16 };

export const GRID_GAP = 8;

export function breakpointFor(width: number): Breakpoint {
  if (width < 640) return 'sm';
  if (width < 1024) return 'md';
  return 'lg';
}

/** [columns wide, rows tall], in grid units. */
export type Span = [number, number];

/**
 * Declared sizes come straight out of a tool's meta.json, where TypeScript sees
 * `number[]` rather than a pair — so the loose type is what's stored and
 * `spanFor` is the single place it becomes a real Span.
 */
export type SizeBySurface = Partial<Record<Breakpoint, number[]>>;

export function spanFor(size: SizeBySurface | undefined, at: Breakpoint): Span {
  // Fall back down the ladder, then to a sensible square, so a tool that only
  // declares one size still works everywhere.
  const raw = size?.[at] ?? size?.lg ?? size?.md ?? size?.sm;
  return raw && raw.length === 2 ? [raw[0], raw[1]] : [4, 4];
}

/**
 * Item ids are prefixed by kind so the stored order can hold tools, actions and
 * fixtures in one list without them colliding.
 */
export const itemId = {
  tool: (slug: string) => `tool:${slug}`,
  action: (id: string) => `action:${id}`,
  stats: 'system:stats',
  theme: 'system:theme',
  edit: 'system:edit',
} as const;

export interface Layout {
  version: number;
  /** Ids in display order. Anything absent is appended, so a newly added tool
   *  shows up rather than vanishing. */
  order: string[];
}

/**
 * Put the known items in the stored order, then anything the stored order has
 * never seen. Ids in the layout that no longer exist are dropped on the way
 * through — an uninstalled tool shouldn't leave a hole.
 */
export function applyOrder(order: string[], present: string[]): string[] {
  const known = new Set(present);
  const placed = order.filter((id) => known.has(id));
  const seen = new Set(placed);
  return [...placed, ...present.filter((id) => !seen.has(id))];
}
