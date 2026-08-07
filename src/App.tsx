import { useEffect, useState } from 'react'
import { api } from './lib/api'

interface DiskStats {
  totalBytes: number
  usedBytes: number
  usagePercent: number
  mount: string
}

interface Stats {
  host: string
  timestamp: number
  cpu: { usagePercent: number | null; loadAvg1: number; cores: number }
  mem: { totalBytes: number; usedBytes: number; usagePercent: number }
  disk: DiskStats
  rootDisk: DiskStats
  net: {
    rxBytesPerSec: number | null
    txBytesPerSec: number | null
    rxBytesTotal: number | null
    txBytesTotal: number | null
  }
}

type HostState =
  { status: 'loading' } | { status: 'ok'; stats: Stats } | { status: 'error'; message: string }

/** "Live" tier — matches the server cache interval in server/src/cache.ts. */
const REFRESH_MS = 5_000

function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—'
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`
}

function formatRate(bytesPerSec: number | null): string {
  if (bytesPerSec === null) return 'n/a'
  return `${formatBytes(bytesPerSec)}/s`
}

function Meter({ label, percent, detail }: { label: string; percent: number; detail: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-ink-dim text-xs font-medium tracking-wide uppercase">{label}</span>
        <span className="font-mono text-sm tabular-nums">{percent}%</span>
      </div>
      <div className="bg-line mt-1.5 h-1.5 w-full overflow-hidden rounded-full">
        <div
          className="bg-accent h-full rounded-full transition-[width] duration-500"
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </div>
      <p className="text-ink-dim mt-1 font-mono text-xs">{detail}</p>
    </div>
  )
}

function HostCard({ host, state }: { host: string; state: HostState }) {
  return (
    <section className="border-line bg-surface rounded-2xl border p-5 shadow-sm sm:p-6">
      <h2 className="text-base font-semibold tracking-tight">{host}</h2>

      {state.status === 'loading' && <p className="text-ink-dim mt-4 text-sm">loading…</p>}

      {state.status === 'error' && (
        <p className="text-danger mt-4 text-sm">error: {state.message}</p>
      )}

      {state.status === 'ok' && (
        <>
          <div className="mt-5 space-y-4">
            <Meter
              label="CPU"
              percent={state.stats.cpu.usagePercent ?? 0}
              detail={`${state.stats.cpu.cores} cores · load ${state.stats.cpu.loadAvg1.toFixed(2)}`}
            />
            <Meter
              label="RAM"
              percent={state.stats.mem.usagePercent}
              detail={`${formatBytes(state.stats.mem.usedBytes)} / ${formatBytes(state.stats.mem.totalBytes)}`}
            />
            <Meter
              label={`Disk ${state.stats.disk.mount}`}
              percent={state.stats.disk.usagePercent}
              detail={`${formatBytes(state.stats.disk.usedBytes)} / ${formatBytes(state.stats.disk.totalBytes)}`}
            />
            <Meter
              label={`OS disk ${state.stats.rootDisk.mount}`}
              percent={state.stats.rootDisk.usagePercent}
              detail={`${formatBytes(state.stats.rootDisk.usedBytes)} / ${formatBytes(state.stats.rootDisk.totalBytes)}`}
            />
          </div>

          <dl className="border-line mt-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t pt-4">
            <dt className="text-ink-dim text-xs font-medium tracking-wide uppercase">Network</dt>
            <dd className="ml-auto font-mono text-sm tabular-nums">
              {state.stats.net.rxBytesPerSec !== null
                ? `↓ ${formatRate(state.stats.net.rxBytesPerSec)}  ↑ ${formatRate(state.stats.net.txBytesPerSec)}`
                : `↓ ${formatBytes(state.stats.net.rxBytesTotal)}  ↑ ${formatBytes(state.stats.net.txBytesTotal)}`}
            </dd>
          </dl>

          <p className="text-ink-dim mt-4 font-mono text-xs">
            updated {new Date(state.stats.timestamp).toLocaleTimeString()}
          </p>
        </>
      )}
    </section>
  )
}

function App() {
  const [hosts, setHosts] = useState<string[]>([])
  const [statsByHost, setStatsByHost] = useState<Record<string, HostState>>({})

  useEffect(() => {
    api<{ hosts: string[] }>('/api/hosts')
      .then((data) => setHosts(data.hosts))
      .catch(() => setHosts([]))
  }, [])

  useEffect(() => {
    if (hosts.length === 0) return

    let cancelled = false

    async function fetchAll() {
      // Nothing to refresh while the tab is hidden — the phone in your pocket
      // should not be polling a wall-display cadence.
      if (document.hidden) return

      await Promise.all(
        hosts.map(async (host) => {
          try {
            const stats = await api<Stats>(`/api/stats/${host}`)
            if (!cancelled) {
              setStatsByHost((prev) => ({ ...prev, [host]: { status: 'ok', stats } }))
            }
          } catch (err) {
            if (!cancelled) {
              setStatsByHost((prev) => ({
                ...prev,
                [host]: { status: 'error', message: (err as Error).message },
              }))
            }
          }
        }),
      )
    }

    fetchAll()
    const interval = setInterval(fetchAll, REFRESH_MS)
    document.addEventListener('visibilitychange', fetchAll)

    return () => {
      cancelled = true
      clearInterval(interval)
      document.removeEventListener('visibilitychange', fetchAll)
    }
  }, [hosts])

  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
      <h1 className="text-2xl font-semibold tracking-tight">zimadash</h1>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {hosts.map((host) => (
          <HostCard key={host} host={host} state={statsByHost[host] ?? { status: 'loading' }} />
        ))}
      </div>
    </main>
  )
}

export default App
