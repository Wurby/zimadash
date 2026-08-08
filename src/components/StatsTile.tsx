import type { Stats } from '@shared/types'
import { api } from '../lib/api'
import { usePolled } from '../lib/refresh'
import { formatBytes, formatRate, formatTime } from '../lib/format'
import { Icon } from './Icon'
import { Meter } from './Meter'

/**
 * System stats as a tile on the dashboard.
 *
 * Expands in place rather than dropping over the page — it is a grid item now,
 * so growing means claiming more of the grid and pushing what follows down.
 * That is honest about the space it takes, which a floating panel never was.
 *
 * Collapsed it is the wordmark and two numbers. The monitoring was the MVP
 * placeholder and this is all the room it gets until asked for more.
 */

type HostStats = [host: string, stats: Stats]

async function fetchAll(): Promise<HostStats[]> {
  const { hosts } = await api<{ hosts: string[] }>('/api/hosts')
  return Promise.all(
    hosts.map(async (host) => [host, await api<Stats>(`/api/stats/${host}`)] as HostStats),
  )
}

function Readout({ label, percent }: { label: string; percent: number }) {
  return (
    <span className="flex items-baseline justify-between gap-1">
      <span className="text-ink-dim text-[0.55rem] leading-none font-medium tracking-wide uppercase">
        {label}
      </span>
      <span className="font-mono text-[0.7rem] leading-none tabular-nums">
        {Math.round(percent)}%
      </span>
    </span>
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

export function StatsTile({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const state = usePolled('live', fetchAll)
  const first = state.status === 'ok' ? state.data[0]?.[1] : null

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="border-line bg-surface hover:border-accent flex h-full w-full items-stretch overflow-hidden border text-left transition-colors"
    >
      <span className="flex w-4 shrink-0 items-center justify-center bg-slate-200 dark:bg-slate-800">
        <span
          aria-hidden="true"
          className="rotate-180 text-[0.75rem] leading-none font-bold tracking-[0.18em] text-slate-600 [writing-mode:vertical-rl] dark:text-slate-300"
        >
          Zimadash
        </span>
      </span>

      <span className="sr-only">zimadash system stats,</span>

      <span className="flex min-w-0 flex-1 flex-col justify-between overflow-hidden p-1.5">
        {open && state.status === 'ok' ? (
          <span className="min-h-0 flex-1 space-y-6 overflow-y-auto">
            {state.data.map(([host, stats]) => (
              <HostStatsCard key={host} host={host} stats={stats} />
            ))}
          </span>
        ) : first ? (
          <span className="flex flex-col gap-1">
            <Readout label="cpu" percent={first.cpu.usagePercent ?? 0} />
            <Readout label="ram" percent={first.mem.usagePercent} />
          </span>
        ) : (
          <span
            className={`font-mono text-[0.7rem] leading-none tabular-nums ${
              state.status === 'error' ? 'text-danger' : 'text-ink-dim'
            }`}
          >
            {state.status === 'error' ? 'offline' : '···'}
          </span>
        )}

        <Icon
          name="chevron"
          className={`text-ink-dim self-end transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </span>
    </button>
  )
}
