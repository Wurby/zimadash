import type { InboxState } from '@shared/inbox'
import { api, apiUpload } from '../../lib/api'

/** Every call this tool makes. Kept in one file so the tool stays liftable. */

const BASE = '/api/tools/inbox'

export function getInbox(): Promise<InboxState> {
  return api<InboxState>(BASE)
}

export interface UploadResult {
  id: string
  filename: string
  bytes: number
  status: 'working'
}

export function uploadFile(file: File, instructions: string): Promise<UploadResult> {
  return apiUpload<UploadResult>(`${BASE}/upload`, file, {
    'X-Inbox-Filename': encodeURIComponent(file.name),
    'X-Inbox-Instructions': encodeURIComponent(instructions),
  })
}

export function dismissEntry(id: string): Promise<{ ok: true }> {
  return api<{ ok: true }>(`${BASE}/${id}`, { method: 'DELETE' })
}
