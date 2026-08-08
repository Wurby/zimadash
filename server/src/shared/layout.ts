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

export const BREAKPOINTS: Breakpoint[] = ['sm', 'md', 'lg'];

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
 * The sizes a tile can be given from the dashboard, as [wide, tall].
 *
 * Deliberately a closed list rather than a free drag-handle. Every one fits
 * inside a phone's eight columns, so the same choice exists on every surface,
 * and a tile can only ever land on a size that was designed for.
 *
 * The ladder starts at 1x1 — one grid unit, the size of a quick action — so a
 * badge can be shrunk to sit among the actions rather than lording over them.
 * Ordered by area so the list reads small-to-large, which is also what puts the
 * seven smallest on the picker's first row.
 */
export const SIZE_OPTIONS: Span[] = [
  [1, 1],
  [2, 1],
  [1, 2],
  [2, 2],
  [3, 2],
  [2, 3],
  [3, 3],
  [4, 3],
  [3, 4],
  [4, 4],
  [6, 4],
  [4, 6],
  [6, 6],
];

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

/**
 * **A badge has two sizes, and both are yours.**
 *
 * A badge is a system readout that expands in place rather than opening as its
 * own screen — the stats badge is the only one today. That makes it unlike a
 * tool in a way that matters here: collapsed and expanded aren't the same thing
 * scaled, they are two different readouts with two different jobs. Collapsed is
 * a glance, and wants to be small enough to sit among the actions. Expanded has
 * to fit every host without scrolling inside itself, and a tile that has
 * claimed a size and then hides half its contents behind a gesture is lying
 * about that size.
 *
 * So each form carries its own declared default here, and each is overridden
 * separately — see `sizeKey`. Registering a badge in this table is all it takes
 * to get both; nothing downstream special-cases the stats badge by name.
 *
 * Badges have no `meta.json` to declare sizes in, since they aren't tools,
 * which is why the defaults live here in the shape a tool would have used.
 */
export interface BadgeSizes {
  collapsed: SizeBySurface;
  expanded: SizeBySurface;
}

export const BADGE_SIZES: Record<string, BadgeSizes> = {
  [itemId.stats]: {
    // Small on a phone, where it is the least interesting thing on screen; a
    // proper square once there is room for one.
    collapsed: { sm: [2, 2], md: [4, 4], lg: [4, 4] },
    // Wider than any rung of SIZE_OPTIONS, deliberately: the expanded readout
    // was measured to fit at this size, and shrinking it brings back the
    // scrolling it was built to avoid. Reset is how you get back to it.
    expanded: { sm: [8, 6], md: [8, 6], lg: [8, 6] },
  },
};

export function isBadge(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(BADGE_SIZES, id);
}

/**
 * Where an item's chosen size is stored.
 *
 * A badge's two forms need two slots, so the expanded one gets a suffixed key.
 * Sizes are keyed independently of the order, so this costs no schema change —
 * a badge is simply two entries in the same flat table.
 */
export function sizeKey(id: string, expanded: boolean): string {
  return expanded ? `${id}#expanded` : id;
}

/**
 * What a tile is actually sized at: your choice if you made one on *this*
 * surface, otherwise what the tool asked for.
 *
 * An override deliberately does **not** fall down the ladder the way a declared
 * size does. Six columns is three quarters of a phone and barely a third of the
 * wall display, so a size chosen in your hand would be a postage stamp across
 * the room. Setting one surface leaves the others alone until you set them too.
 */
export function resolveSpan(
  declared: SizeBySurface | undefined,
  override: SizeBySurface | undefined,
  at: Breakpoint,
): Span {
  return overrideSpan(override, at) ?? spanFor(declared, at);
}

/** The size chosen for this surface, or null while the tool's own still holds. */
export function overrideSpan(override: SizeBySurface | undefined, at: Breakpoint): Span | null {
  const raw = override?.[at];
  return raw && raw.length === 2 ? [raw[0], raw[1]] : null;
}

export interface Layout {
  version: number;
  /** Ids in display order. Anything absent is appended, so a newly added tool
   *  shows up rather than vanishing. */
  order: string[];
  /**
   * Sizes you have chosen, by item id, per surface. Absent means the tool's
   * declared size still stands — which is why this is sparse rather than a full
   * table: it records only what you actually overrode.
   */
  sizes?: Record<string, SizeBySurface>;
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
