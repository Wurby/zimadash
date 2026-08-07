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

/**
 * One figure in the collapsed badge. The label carries its own weight — a bare
 * "12% · 34%" tells you nothing about which number is which, and this is meant
 * to be read at a glance from across the room.
 *
 * Label left, value right, so the percentages line up as a column.
 */
function Readout({ label, percent }: { label: string; percent: number }) {
  return (
    <span className="flex items-baseline justify-between gap-1">
      <span className="text-ink-dim text-[0.5rem] leading-none font-medium tracking-wide uppercase">
        {label}
      </span>
      <span className="font-mono text-[0.65rem] leading-none tabular-nums">
        {Math.round(percent)}%
      </span>
    </span>
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

  return (
    <div ref={wrapper} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        // 2x2 on the header grid: two action cells plus the gap between them,
        // which is why this is size-20 against the actions' size-9.
        className="border-line hover:border-accent flex size-20 items-stretch gap-2 rounded-xl border p-1 text-left transition-colors"
      >
        {/* Vertical wordmark down the left edge, reading bottom-to-top like a
            spine. vertical-rl rotates the whole line rather than stacking
            glyphs, so this takes the string's normal width (~50px) along the
            badge's height and only its line box of width.

            It gets an explicit centred column rather than self-center alone:
            the vertical line box puts the baseline off to one side, so without
            a column to centre in it sits visibly left of true. */}
        <span className="flex w-4 shrink-0 items-center justify-center">
          <span
            aria-hidden="true"
            className="text-ink-dim rotate-180 text-[0.6rem] leading-none font-medium tracking-[0.15em] [writing-mode:vertical-rl]"
          >
            zimadash
          </span>
        </span>

        {/* Not an aria-label on the button — that would replace the readout for
            screen readers instead of introducing it. */}
        <span className="sr-only">zimadash system stats,</span>

        <span className="flex min-w-0 flex-1 flex-col justify-between">
          {first ? (
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

      {open && (
        // Anchored to the bottom-left of the badge so it opens down-and-right,
        // and capped in both axes against the viewport — the full panel is
        // taller than a phone in landscape, so it scrolls rather than running
        // off-screen.
        <div className="border-line bg-surface absolute top-full left-0 z-20 mt-2 max-h-[calc(100dvh-8rem)] w-[min(24rem,calc(100vw-1.5rem))] overflow-y-auto overscroll-contain rounded-2xl border p-5 shadow-lg">
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
