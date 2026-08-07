/** Shared display formatting. Tools and the stats panel both read from here. */

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—'
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`
}

export function formatRate(bytesPerSec: number | null): string {
  if (bytesPerSec === null) return 'n/a'
  return `${formatBytes(bytesPerSec)}/s`
}

export function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString()
}
