import type { CountdownView } from '@shared/countdowns'
import { api } from '../../lib/api'

/** Every call this tool makes. Kept in one file so the tool stays liftable. */

const BASE = '/api/tools/countdowns'

export interface CountdownList {
  items: CountdownView[]
}

export function getCountdowns(): Promise<CountdownList> {
  return api<CountdownList>(BASE)
}

export function addCountdown(label: string, date: string, yearly: boolean): Promise<CountdownList> {
  return api<CountdownList>(`${BASE}/items`, {
    method: 'POST',
    body: JSON.stringify({ label, date, yearly }),
  })
}

export interface CountdownPatch {
  label?: string
  date?: string
  yearly?: boolean
}

export function patchCountdown(id: string, patch: CountdownPatch): Promise<CountdownList> {
  return api<CountdownList>(`${BASE}/items/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

export function deleteCountdown(id: string): Promise<CountdownList> {
  return api<CountdownList>(`${BASE}/items/${id}`, { method: 'DELETE' })
}
