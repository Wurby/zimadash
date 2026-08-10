import type {
  DayCell,
  ExerciseDef,
  ExerciseGuide,
  Implement,
  Inventory,
  PersonalRecord,
  Rating,
  Session,
  SessionType,
  WeekSummary,
} from '@shared/trainer'
import { api } from '../../lib/api'

/** Every call this tool makes. Kept in one file so the tool stays liftable. */

const BASE = '/api/tools/trainer'

export interface Overview {
  next: SessionType
  active: Session | null
  lastSession: { date: string; type: SessionType } | null
  thisWeek: number
  streak: number
  sessionCount: number
  hasSettings: boolean
}

export interface Progress {
  grid: DayCell[]
  weeks: WeekSummary[]
  streak: number
  records: PersonalRecord[]
  perSession: { date: string; type: SessionType; volume: number }[]
}

export interface Settings {
  inventory: Inventory
  catalogue: ExerciseDef[]
  policy: string
  ladders: Record<Implement, number[]>
}

export interface LiftPoint {
  date: string
  weightLb: number
  sets: number
  reps: number
  rating: Rating
}

export function getOverview(): Promise<Overview> {
  return api<Overview>(BASE)
}

export function getProgress(): Promise<Progress> {
  return api<Progress>(`${BASE}/progress`)
}

export function getLift(exercise: string): Promise<{ exercise: string; points: LiftPoint[] }> {
  return api(`${BASE}/progress/${encodeURIComponent(exercise)}`)
}

export function getSettings(): Promise<Settings> {
  return api<Settings>(`${BASE}/settings`)
}

export function putSettings(patch: {
  inventory?: Inventory
  policy?: string
  catalogue?: ExerciseDef[]
}): Promise<Settings> {
  return api<Settings>(`${BASE}/settings`, { method: 'PUT', body: JSON.stringify(patch) })
}

export function getSessions(range: { from?: string; to?: string } = {}): Promise<{
  sessions: Session[]
}> {
  const query = new URLSearchParams()
  if (range.from) query.set('from', range.from)
  if (range.to) query.set('to', range.to)
  const suffix = query.toString() ? `?${query}` : ''
  return api(`${BASE}/sessions${suffix}`)
}

export function getPlan(): Promise<{ session: Session; plannedBy: Session['plannedBy'] }> {
  return api(`${BASE}/plan`)
}

/** Slow — a process spawn plus model time. The rules plan is shown while this
 *  runs and swapped out when it lands. */
export function planWithModel(): Promise<{ session: Session; reasoning: string }> {
  return api(`${BASE}/plan/model`, { method: 'POST' })
}

export function importVault(markdown: string): Promise<{
  imported: number
  replaced: number
  notes: string[]
}> {
  return api(`${BASE}/import`, { method: 'POST', body: JSON.stringify({ markdown }) })
}

// ─── Running a session ───────────────────────────────────────────────────────

export function startSession(): Promise<{ session: Session }> {
  return api(`${BASE}/sessions`, { method: 'POST' })
}

export function getActive(): Promise<{ session: Session | null }> {
  return api(`${BASE}/sessions/active`)
}

export interface ResultInput {
  rating?: Rating
  weightLb?: number
  sets?: number
  reps?: number
  note?: string
  skipped?: boolean
  skipReason?: string
}

export function recordResult(
  id: string,
  index: number,
  result: ResultInput,
): Promise<{ session: Session; allDone: boolean }> {
  return api(`${BASE}/sessions/${id}/exercises/${index}`, {
    method: 'PATCH',
    body: JSON.stringify(result),
  })
}

export interface Alternative {
  name: string
  implement: Implement
  kind: 'compound' | 'accessory'
  kneeLoaded: boolean
  note?: string
}

export function getAlternatives(
  id: string,
  index: number,
): Promise<{ alternatives: Alternative[] }> {
  return api(`${BASE}/sessions/${id}/alternatives/${index}`)
}

export function swapExercise(
  id: string,
  index: number,
  name: string,
): Promise<{ session: Session }> {
  return api(`${BASE}/sessions/${id}/exercises/${index}/swap`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export function addExercise(id: string, name: string): Promise<{ session: Session }> {
  return api(`${BASE}/sessions/${id}/exercises`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export function finishSession(
  id: string,
): Promise<{ session: Session; records: PersonalRecord[] }> {
  return api(`${BASE}/sessions/${id}/finish`, { method: 'POST' })
}

export function abandonSession(id: string): Promise<{ ok: boolean }> {
  return api(`${BASE}/sessions/${id}`, { method: 'DELETE' })
}

/**
 * The long-form how-to for a movement.
 *
 * Cached server-side per exercise, so only the first ask waits on the model.
 * `refresh` writes a new one when the old reads badly.
 */
export function getGuide(
  exercise: string,
  refresh = false,
): Promise<{ guide: ExerciseGuide; cached: boolean }> {
  const suffix = refresh ? '?refresh=1' : ''
  return api(`${BASE}/exercises/${encodeURIComponent(exercise)}/guide${suffix}`)
}
