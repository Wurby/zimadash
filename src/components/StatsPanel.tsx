import { useEffect, useRef, useState } from 'react'
import type { Stats } from '@shared/types'
import { api } from '../lib/api'
import { usePolled } from '../lib/refresh'
import { formatBytes, formatRate, formatTime } from '../lib/format'
import { Icon } from './Icon'
import { Meter } from './Meter'

/**
 * System stats as a header panel rather than the homepage.
 *
 * The monitoring was the MVP placeholder and is not what the dash is for, so it
 * gets a collapsed summary you can glance at and an expanded panel you have to
 * ask for. `/api/hosts` is a static in-memory list, so polling it alongside the
 * stats costs nothing and keeps this to a single tick.
 */

type HostStats = [host: string, stats: Stats]

async function fetchAll(): Promise<HostStats[]> {
  const { hosts } = await api<{ hosts: string[] }>('/api/hosts')
  return Promise.all(
    hosts.map(async (host) => [host, await api<Stats>(`/api/stats/${host}`)] as HostStats),
  )
}

function HostStatsCard({ host, stats }: { host: string; stats: Stats }) {
  return (
    <section>
      <h3 className="text-sm font-semibold tracking-tight">{host}</h3>

      <div className="mt-3 space-y-3">
        <Meter
          label="CPU"
          percent={stats.cpu.usagePercent ?? 0}
          detail={`${stats.cpu.cores} cores · load ${stats.cpu.loadAvg1.toFixed(2)}`}
        />
        <Meter
          label="RAM"
          percent={stats.mem.usagePercent}
          detail={`${formatBytes(stats.mem.usedBytes)} / ${formatBytes(stats.mem.totalBytes)}`}
        />
        <Meter
          label={`Disk ${stats.disk.mount}`}
          percent={stats.disk.usagePercent}
          detail={`${formatBytes(stats.disk.usedBytes)} / ${formatBytes(stats.disk.totalBytes)}`}
        />
        <Meter
          label={`OS disk ${stats.rootDisk.mount}`}
          percent={stats.rootDisk.usagePercent}
          detail={`${formatBytes(stats.rootDisk.usedBytes)} / ${formatBytes(stats.rootDisk.totalBytes)}`}
        />
      </div>

      <dl className="border-line mt-4 flex flex-wrap items-baseline justify-between gap-x-4 border-t pt-3">
        <dt className="text-ink-dim text-xs font-medium tracking-wide uppercase">Network</dt>
        <dd className="ml-auto font-mono text-sm tabular-nums">
          {stats.net.rxBytesPerSec !== null
            ? `↓ ${formatRate(stats.net.rxBytesPerSec)}  ↑ ${formatRate(stats.net.txBytesPerSec)}`
            : `↓ ${formatBytes(stats.net.rxBytesTotal)}  ↑ ${formatBytes(stats.net.txBytesTotal)}`}
        </dd>
      </dl>

      <p className="text-ink-dim mt-3 font-mono text-xs">updated {formatTime(stats.timestamp)}</p>
    </section>
  )
}

export function StatsPanel() {
  const [open, setOpen] = useState(false)
  const wrapper = useRef<HTMLDivElement>(null)
  const state = usePolled('live', fetchAll)

  // Tap away to collapse. Pointerdown rather than click so a tap that starts
  // outside and drags in still closes it.
  useEffect(() => {
    if (!open) return

    function onPointerDown(event: PointerEvent) {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const first = state.status === 'ok' ? state.data[0]?.[1] : null
  const summary = first
    ? `${Math.round(first.cpu.usagePercent ?? 0)}% · ${Math.round(first.mem.usagePercent)}%`
    : state.status === 'error'
      ? '—'
      : '···'

  return (
    <div ref={wrapper} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-label="System stats"
        className="border-line hover:border-accent flex items-center gap-2 rounded-lg border px-2.5 py-1.5 transition-colors"
      >
        <Icon
          name="activity"
          className={state.status === 'error' ? 'text-danger' : 'text-accent'}
        />
        <span className="font-mono text-xs tabular-nums">{summary}</span>
        <Icon
          name="chevron"
          className={`text-ink-dim transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="border-line bg-surface absolute right-0 z-20 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border p-5 shadow-lg">
          {state.status === 'loading' && <p className="text-ink-dim text-sm">loading…</p>}

          {state.status === 'error' && (
            <p className="text-danger text-sm">error: {state.message}</p>
          )}

          {state.status === 'ok' && state.data.length === 0 && (
            <p className="text-ink-dim text-sm">no hosts reporting</p>
          )}

          {state.status === 'ok' && (
            <div className="space-y-6">
              {state.data.map(([host, stats]) => (
                <HostStatsCard key={host} host={host} stats={stats} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
