import { readJson, writeJson } from '../../paths.js';
import type { Entry } from '../../shared/calories.js';
import { complete } from './brain.js';
import { allEntries } from './storage.js';

/**
 * Fuzzy meal clusters for the Today tab's Again chips.
 *
 * Photo estimates name the same food slightly differently each time, so "most
 * recent distinct names" under-counts the meals you actually repeat. Grok
 * groups the wordings; we average the numbers. The pass runs about weekly on
 * the always-on process — not on view — and Today reads the cache.
 */

const FILE = 'calories/clusters.json';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const CHIP_MAX = 12;
const CLUSTER_TIMEOUT_MS = 180_000;

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

function pickWeighted<T extends { count: number }>(items: T[], n: number): T[] {
  const pool = [...items];
  const picked: T[] = [];
  const want = Math.min(n, pool.length);

  while (picked.length < want && pool.length > 0) {
    const total = pool.reduce((sum, item) => sum + item.count, 0);
    let ticket = Math.random() * total;
    let index = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      ticket -= pool[i].count;
      if (ticket <= 0) {
        index = i;
        break;
      }
    }
    picked.push(pool.splice(index, 1)[0]);
  }

  return picked;
}

function namedEntries(): Entry[] {
  return allEntries().filter(
    (entry) => entry.description.trim() && Object.keys(entry.values).length > 0,
  );
}

function buildPrompt(names: { name: string; count: number }[]): string {
  const list = names.map((row) => `  ${JSON.stringify(row.name)} × ${row.count}`).join('\n');

  return `You group meal names that are the same food logged under slightly different wording.

These names come from a calorie log. Many were titled by a vision model looking
at a photograph, so the same plate shows up as several near-phrasings.

Names with how often they were logged:

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
  const entries = namedEntries();
  const byName = new Map<string, Entry[]>();
  for (const entry of entries) {
    const name = entry.description.trim();
    const list = byName.get(name) ?? [];
    list.push(entry);
    byName.set(name, list);
  }

  const names = [...byName.entries()]
    .map(([name, list]) => ({ name, count: list.length }))
    .sort((a, b) => b.count - a.count);

  if (names.length === 0) {
    const empty: ClusterCache = { version: 1, at: Date.now(), chips: [] };
    writeJson(FILE, empty);
    return empty;
  }

  const known = new Set(names.map((row) => row.name));
  const prompt = buildPrompt(names);
  const grouped = await (async () => {
    try {
      return parseClusters(await complete(prompt, '', CLUSTER_TIMEOUT_MS), known);
    } catch (first) {
      if (first instanceof Error && /timed out|not installed|not logged in/.test(first.message)) {
        throw first;
      }
      return parseClusters(await complete(prompt, '', CLUSTER_TIMEOUT_MS), known);
    }
  })();

  const scored = grouped.map((cluster) => {
    const members = cluster.members.flatMap((name) => byName.get(name) ?? []);
    return {
      label: cluster.label,
      count: members.length,
      values: averageValues(members),
    };
  });

  const chipCount = Math.min(CHIP_MAX, scored.length);
  const chips = pickWeighted(scored, chipCount).map((cluster) => ({
    description: cluster.label,
    values: cluster.values,
  }));

  const cache: ClusterCache = { version: 1, at: Date.now(), chips };
  writeJson(FILE, cache);
  return cache;
}

function loadCache(): ClusterCache | null {
  const file = readJson<ClusterCache>(FILE);
  if (!file || !Array.isArray(file.chips) || typeof file.at !== 'number') return null;
  return file;
}

/** Cached chips, or null when the weekly pass has not succeeded yet. */
export function cachedChips(): ClusterChip[] | null {
  const cache = loadCache();
  return cache && cache.chips.length > 0 ? cache.chips : null;
}

async function tick(): Promise<void> {
  const cache = loadCache();
  if (cache && Date.now() - cache.at < WEEK_MS) return;
  try {
    await rebuild();
  } catch (err) {
    console.error('calories cluster pass failed:', err instanceof Error ? err.message : err);
  }
}

/** Kick a pass if the cache is stale, then again every week. Never on a view. */
export function startClusterLoop(): void {
  void tick();
  setInterval(() => void tick(), WEEK_MS);
}
