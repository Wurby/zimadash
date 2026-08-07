import { api } from '../../lib/api'
import type {
  DaySummary,
  Entry,
  FieldConfig,
  PendingEstimate,
  RangeKey,
  Settings,
} from '@shared/calories'

/** Every call this tool makes. Nothing else reaches outside the folder. */

const BASE = '/api/tools/calories'

export interface DayTotals {
  date: string
  totals: Record<string, number>
}

export interface RangeData {
  from: string
  to: string
  days: DayTotals[]
}

export interface RecentMeal {
  description: string
  values: Record<string, number>
}

export const getSettings = () => api<Settings>(`${BASE}/settings`)

export const putSettings = (settings: Settings) =>
  api<Settings>(`${BASE}/settings`, { method: 'PUT', body: JSON.stringify(settings) })

export const getDay = () => api<DaySummary>(`${BASE}/day`)

export const getRange = (range: RangeKey) => api<RangeData>(`${BASE}/range/${range}`)

export const getLog = () => api<{ entries: Entry[] }>(`${BASE}/log`)

export const getRecent = () => api<{ meals: RecentMeal[] }>(`${BASE}/recent`)

export const startEstimate = (description: string) =>
  api<PendingEstimate>(`${BASE}/estimate`, {
    method: 'POST',
    body: JSON.stringify({ description }),
  })

export const estimateFromPhoto = (image: string) =>
  api<PendingEstimate>(`${BASE}/estimate/image`, {
    method: 'POST',
    body: JSON.stringify({ image }),
  })

export const refineEstimate = (id: string, feedback: string) =>
  api<PendingEstimate>(`${BASE}/estimate/${id}/refine`, {
    method: 'POST',
    body: JSON.stringify({ feedback }),
  })

export const commitEstimate = (pendingId: string, values: Record<string, number>) =>
  api<Entry>(`${BASE}/entries`, { method: 'POST', body: JSON.stringify({ pendingId, values }) })

export const logDirect = (description: string, values: Record<string, number>) =>
  api<Entry>(`${BASE}/entries`, { method: 'POST', body: JSON.stringify({ description, values }) })

export const patchEntry = (id: string, values: Record<string, number>) =>
  api<Entry>(`${BASE}/entries/${id}`, { method: 'PATCH', body: JSON.stringify({ values }) })

export const deleteEntry = (id: string) =>
  api<{ ok: true }>(`${BASE}/entries/${id}`, {
    method: 'DELETE',
  })

/** Fields still being tracked, in configured order. */
export const tracked = (settings: Settings | null): FieldConfig[] =>
  settings?.fields.filter((field) => field.tracked) ?? []

export function formatValue(value: number, field: FieldConfig): string {
  const rounded = Math.round(value * 10) / 10
  return `${rounded}${field.unit && field.unit !== 'kcal' ? field.unit : ''}`
}
