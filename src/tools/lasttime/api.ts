import type { ItemView } from '@shared/lasttime'
import { api } from '../../lib/api'

/** Every call this tool makes. Kept in one file so the tool stays liftable. */

const BASE = '/api/tools/lasttime'

export interface ItemList {
  items: ItemView[]
}

export function getItems(): Promise<ItemList> {
  return api<ItemList>(BASE)
}

export function tapItem(id: string): Promise<ItemList> {
  return api<ItemList>(`${BASE}/items/${id}/tap`, { method: 'POST' })
}

export function undoTap(id: string): Promise<ItemList> {
  return api<ItemList>(`${BASE}/items/${id}/undo`, { method: 'POST' })
}

export function addItem(label: string, defaultDays: number): Promise<ItemList> {
  return api<ItemList>(`${BASE}/items`, {
    method: 'POST',
    body: JSON.stringify({ label, defaultDays }),
  })
}

export interface ItemPatch {
  label?: string
  defaultDays?: number
  overrideDays?: number | null
  onTile?: boolean
}

export function patchItem(id: string, patch: ItemPatch): Promise<ItemList> {
  return api<ItemList>(`${BASE}/items/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

export function deleteItem(id: string): Promise<ItemList> {
  return api<ItemList>(`${BASE}/items/${id}`, { method: 'DELETE' })
}
