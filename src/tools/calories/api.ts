import { api } from '../../lib/api'
import type {
  DaySummary,
  DigestionEntry,
  DigestionPatterns,
  DigestionRangeData,
  Entry,
  Expenditure,
  FieldConfig,
  LogGrain,
  LogSummary,
  QueuedMeal,
  RangeKey,
  ReestimateStatus,
  Settings,
  Severity,
  Suspects,
  WeightReading,
} from '@shared/calories'

/** Every call this tool makes. Nothing else reaches outside the folder. */

const BASE = '/api/tools/calories'

export interface DayTotals {
  date: string
  totals: Record<string, number>
}

export interface RangeWindow {
  from: string
  to: string
  days: DayTotals[]
}

export interface RangeData extends RangeWindow {
  /** The same-length window immediately before `from`. For period-over-period. */
  previous: RangeWindow
}

export interface RecentMeal {
  description: string
  values: Record<string, number>
}

export const getSettings = () => api<Settings>(`${BASE}/settings`)

export const putSettings = (settings: Settings) =>
  api<Settings>(`${BASE}/settings`, { method: 'PUT', body: JSON.stringify(settings) })

export const getDay = () => api<DaySummary>(`${BASE}/day`)

export interface WeightData {
  readings: WeightReading[]
  trend: WeightReading[]
  expenditure: Expenditure
}

export const getWeight = () => api<WeightData>(`${BASE}/weight`)

export const putWeight = (date: string, lb: number) =>
  api<{ readings: WeightReading[] }>(`${BASE}/weight/${date}`, {
    method: 'PUT',
    body: JSON.stringify({ lb }),
  })

export const deleteWeight = (date: string) =>
  api<{ readings: WeightReading[] }>(`${BASE}/weight/${date}`, { method: 'DELETE' })

export const resetBaseline = () => api<Settings>(`${BASE}/weight/baseline`, { method: 'POST' })

/**
 * The calorie goal actually in force.
 *
 * When the computed target is switched on and the tool has learned enough, it
 * replaces the hand-set goal — everything downstream reads `field.goal`, so
 * substituting it here means the bar, the stat rows and the graph's reference
 * line all follow without knowing anything about weight.
 */
export function withEffectiveGoal(
  fields: FieldConfig[],
  settings: Settings | null,
  expenditure: Expenditure | null,
): FieldConfig[] {
  const target = expenditure?.target
  if (!settings?.weight.useComputedTarget || typeof target !== 'number') return fields
  return fields.map((field) => (field.id === 'calories' ? { ...field, goal: target } : field))
}

export const getRange = (range: RangeKey) => api<RangeData>(`${BASE}/range/${range}`)

export interface LogView {
  grain: LogGrain
  today: string
  date: string
  from: string
  to: string
  summary: LogSummary
  totals: Record<string, number>
  entries: Entry[]
  /** Day grain only — empty for week/month/year. */
  episodes: DigestionEntry[]
  /** Day grain only — that day's weigh-in, or null. */
  weightLb: number | null
  pills: RecentMeal[]
  loggedDays: string[]
  loggedMonths: string[]
}

export interface LogHit {
  date: string
  entry: Entry
}

export const getLogView = (grain: LogGrain, date: string) =>
  api<LogView>(`${BASE}/log?grain=${grain}&date=${date}`)

export const searchLog = (q: string) =>
  api<{ hits: LogHit[] }>(`${BASE}/log/search?q=${encodeURIComponent(q)}`)

export const getRecent = () => api<{ meals: RecentMeal[] }>(`${BASE}/recent`)

export interface ReviewState {
  today: string
  day: string
  items: QueuedMeal[]
  entries: Entry[]
  totals: Record<string, number>
  adjusting: boolean
  adjustError: string | null
}

export const getReview = () => api<ReviewState>(`${BASE}/review`)

export const queuePhoto = (image: string) =>
  api<QueuedMeal>(`${BASE}/queue/photo`, { method: 'POST', body: JSON.stringify({ image }) })

export const queueText = (description: string) =>
  api<QueuedMeal>(`${BASE}/queue/text`, {
    method: 'POST',
    body: JSON.stringify({ description }),
  })

export const queueDirect = (description: string, values: Record<string, number>) =>
  api<QueuedMeal>(`${BASE}/queue/direct`, {
    method: 'POST',
    body: JSON.stringify({ description, values }),
  })

export const dropQueued = (id: string) =>
  api<{ ok: true }>(`${BASE}/queue/${id}`, { method: 'DELETE' })

export const fillQueued = (id: string, body: { description?: string; image?: string }) =>
  api<QueuedMeal>(`${BASE}/queue/${id}/fill`, {
    method: 'POST',
    body: JSON.stringify(body),
  })

export const adjustQueued = (day: string, feedback: string) =>
  api<{ ok: true }>(`${BASE}/queue/adjust`, {
    method: 'POST',
    body: JSON.stringify({ day, feedback }),
  })

export const logDirect = (description: string, values: Record<string, number>) =>
  api<Entry>(`${BASE}/entries`, { method: 'POST', body: JSON.stringify({ description, values }) })

/**
 * Fire off a background correction for one logged entry. Never blocks on the
 * brain — it shares a single process with every other queued capture, so the
 * result is read back with `getReestimate` instead of waiting on this call.
 */
export const askReestimate = (id: string, feedback: string) =>
  api<{ ok: true }>(`${BASE}/entries/${id}/reestimate`, {
    method: 'POST',
    body: JSON.stringify({ feedback }),
  })

export const getReestimate = (id: string) =>
  api<ReestimateStatus>(`${BASE}/entries/${id}/reestimate`)

export const clearReestimate = (id: string) =>
  api<{ ok: true }>(`${BASE}/entries/${id}/reestimate`, { method: 'DELETE' })

export const patchEntry = (id: string, patch: { values?: Record<string, number>; at?: number }) =>
  api<Entry>(`${BASE}/entries/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })

export const deleteEntry = (id: string) =>
  api<{ ok: true }>(`${BASE}/entries/${id}`, {
    method: 'DELETE',
  })

// ─── Digestion ───────────────────────────────────────────────────────────────

export const logEpisode = (severity: Severity) =>
  api<DigestionEntry>(`${BASE}/digestion`, { method: 'POST', body: JSON.stringify({ severity }) })

export const patchEpisode = (id: string, patch: { severity?: Severity; at?: number }) =>
  api<DigestionEntry>(`${BASE}/digestion/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })

export const deleteEpisode = (id: string) =>
  api<{ ok: true }>(`${BASE}/digestion/${id}`, { method: 'DELETE' })

export const getSuspects = () => api<Suspects>(`${BASE}/digestion/suspects`)

export const getDigestionPatterns = () => api<DigestionPatterns>(`${BASE}/digestion/patterns`)

export const getDigestionRange = (range: RangeKey) =>
  api<DigestionRangeData>(`${BASE}/digestion/range/${range}`)

/** Fields still being tracked, in configured order. */
export const tracked = (settings: Settings | null): FieldConfig[] =>
  settings?.fields.filter((field) => field.tracked) ?? []

export function formatValue(value: number, field: FieldConfig): string {
  const rounded = Math.round(value * 10) / 10
  return `${rounded}${field.unit && field.unit !== 'kcal' ? field.unit : ''}`
}
