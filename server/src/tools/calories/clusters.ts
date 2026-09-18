import { personal, readJson, writeJson } from '../../paths.js';
import { listUsers } from '../../auth.js';
import { runAs } from '../../context.js';
import type { Entry } from '../../shared/calories.js';
import { complete } from './brain.js';
import { allEntries } from './storage.js';

/**
 * Fuzzy meal clusters for the Today tab's Again chips.
 *
 * Photo estimates name the same food slightly differently each time, so exact
 * names under-count repeats. Grok groups the wordings; we average the numbers
 * and keep the twelve groups logged most often.
 *
 * The pass looks at the last 60 days and rebuilds about monthly. It goes
 * through the process-wide Grok queue (one CLI at a time) with a 30-minute
 * hang cap. Today reads the cache when it is fresh; otherwise it falls back
 * to exact-name counts over the same window so a failed pass cannot freeze
 * last month's chips.
 */

function file(): string {
  return personal('calories/clusters.json');
}

const VERSION = 2;
const WINDOW_MS = 60 * 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
/** 6h is under Node's 32-bit timer max. A 30-day interval overflows and fires continuously. */
const CHECK_MS = 6 * 60 * 60 * 1000;
const CHIP_MAX = 12;
/** Hang cap. Concurrency is the process-wide Grok queue, not this number. */
const CLUSTER_TIMEOUT_MS = 30 * 60 * 1000;

export interface ClusterChip {
  description: string;
  values: Record<string, number>;
}

interface ClusterCache {
  version: number;
  at: number;
  chips: ClusterChip[];
}

function averageValues(entries: Entry[]): Record<string, number> {
  const sums: Record<string, { sum: number; n: number }> = {};
  for (const entry of entries) {
    for (const [key, value] of Object.entries(entry.values)) {
      const slot = sums[key] ?? { sum: 0, n: 0 };
      slot.sum += value;
      slot.n += 1;
      sums[key] = slot;
    }
  }
  const values: Record<string, number> = {};
  for (const [key, slot] of Object.entries(sums)) {
    values[key] = Math.round((slot.sum / slot.n) * 10) / 10;
  }
  return values;
}

function namedInWindow(): Entry[] {
  const cutoff = Date.now() - WINDOW_MS;
  return allEntries().filter(
    (entry) =>
      entry.at >= cutoff && entry.description.trim() && Object.keys(entry.values).length > 0,
  );
}

function groupedByName(entries: Entry[]): Map<string, Entry[]> {
  const byName = new Map<string, Entry[]>();
  for (const entry of entries) {
    const name = entry.description.trim();
    const list = byName.get(name) ?? [];
    list.push(entry);
    byName.set(name, list);
  }
  return byName;
}

function topChips(groups: { label: string; members: Entry[] }[]): ClusterChip[] {
  return [...groups]
    .sort((a, b) => b.members.length - a.members.length)
    .slice(0, CHIP_MAX)
    .map((group) => ({
      description: group.label,
      values: averageValues(group.members),
    }));
}

/** Exact-name counts over the window. Used until a Grok pass has landed. */
export function fallbackChips(): ClusterChip[] {
  const byName = groupedByName(namedInWindow());
  return topChips([...byName.entries()].map(([label, members]) => ({ label, members })));
}

function buildPrompt(names: { name: string; count: number }[]): string {
  const list = names.map((row) => `  ${JSON.stringify(row.name)} × ${row.count}`).join('\n');

  return `You group meal names that are the same food logged under slightly different wording.

These names come from a calorie log. Many were titled by a vision model looking
at a photograph, so the same plate shows up as several near-phrasings.

Names with how often they were logged in the last 60 days:

${list}

Reply with a single JSON object and nothing else — no prose, no code fence:

{
  "clusters": [
    {
      "label": "<short everyday name for this food>",
      "members": ["<exact names from the list that belong here>"]
    }
  ]
}

Rules:
- Every name above appears in exactly one cluster's members.
- members values must be copied exactly from the list.
- Merge only when they are the same meal, not merely the same protein or cuisine.
- Do not invent names that were not listed.
- A unique meal is its own cluster of one.`;
}

function parseClusters(reply: string, known: Set<string>): { label: string; members: string[] }[] {
  const match = reply.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('unparseable');

  const body = JSON.parse(match[0]) as { clusters?: unknown };
  if (!Array.isArray(body.clusters)) throw new Error('no clusters');

  const used = new Set<string>();
  const clusters: { label: string; members: string[] }[] = [];

  for (const raw of body.clusters as Record<string, unknown>[]) {
    const label = typeof raw.label === 'string' ? raw.label.trim() : '';
    const members = Array.isArray(raw.members)
      ? raw.members.filter((name): name is string => typeof name === 'string' && known.has(name))
      : [];
    const unique = members.filter((name) => {
      if (used.has(name)) return false;
      used.add(name);
      return true;
    });
    if (!label || unique.length === 0) continue;
    clusters.push({ label, members: unique });
  }

  for (const name of known) {
    if (used.has(name)) continue;
    clusters.push({ label: name, members: [name] });
  }

  return clusters;
}

async function rebuild(): Promise<ClusterCache> {
  const byName = groupedByName(namedInWindow());
  const names = [...byName.entries()]
    .map(([name, list]) => ({ name, count: list.length }))
    .sort((a, b) => b.count - a.count);

  if (names.length === 0) {
    const empty: ClusterCache = { version: VERSION, at: Date.now(), chips: [] };
    writeJson(file(), empty);
    return empty;
  }

  const known = new Set(names.map((row) => row.name));
  const prompt = buildPrompt(names);
  const grouped = await (async () => {
    try {
      return parseClusters(await complete(prompt, '', CLUSTER_TIMEOUT_MS), known);
    } catch (first) {
      if (first instanceof Error && /not installed|not logged in/.test(first.message)) {
        throw first;
      }
      return parseClusters(await complete(prompt, '', CLUSTER_TIMEOUT_MS), known);
    }
  })();

  const chips = topChips(
    grouped.map((cluster) => ({
      label: cluster.label,
      members: cluster.members.flatMap((name) => byName.get(name) ?? []),
    })),
  );

  const cache: ClusterCache = { version: VERSION, at: Date.now(), chips };
  writeJson(file(), cache);
  return cache;
}

function loadCache(): ClusterCache | null {
  const stored = readJson<ClusterCache>(file());
  if (!stored || stored.version !== VERSION) return null;
  if (!Array.isArray(stored.chips) || typeof stored.at !== 'number') return null;
  if (Date.now() - stored.at >= MONTH_MS) return null;
  return stored;
}

/** Cached chips, or null when the monthly pass has not succeeded recently. */
export function cachedChips(): ClusterChip[] | null {
  const cache = loadCache();
  return cache && cache.chips.length > 0 ? cache.chips : null;
}

let passing = false;

async function tick(): Promise<void> {
  if (loadCache()) return;
  try {
    await rebuild();
  } catch (err) {
    console.error('calories cluster pass failed:', err instanceof Error ? err.message : err);
  }
}

async function tickAll(): Promise<void> {
  if (passing) return;
  passing = true;
  try {
    for (const user of listUsers()) {
      await runAs(user, () => tick());
    }
  } finally {
    passing = false;
  }
}

/** Kick a pass if the cache is stale. Recheck every six hours; rebuild at most monthly. */
export function startClusterLoop(): void {
  void tickAll();
  setInterval(() => void tickAll(), CHECK_MS);
}
