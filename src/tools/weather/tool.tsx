import {
  RAIN_THRESHOLD,
  describeCode,
  formatTemp,
  rainOutlook,
  shortDay,
  shortHour,
  type Section,
  type TemperatureUnit,
  type WeatherDay,
  type WeatherHour,
  type WeatherReport,
} from '@shared/weather'
import { usePolled } from '../../lib/refresh'
import { defineTool } from '../types'
import meta from './meta.json'
import { getWeather } from './api'
import { WeatherIcon } from './WeatherIcon'
import { Config } from './Config'

/**
 * Weather — what it's doing outside.
 *
 * `slow`: the forecast models only update every few minutes, so polling on
 * `ambient` was re-fetching a number that could not have moved — about 1,400
 * upstream calls a day for it. The server cache is on the same tier, so neither
 * half can drift ahead of the other. A tab still fetches on mount and on
 * becoming visible, so picking up your phone gets you current data regardless.
 *
 * Which blocks appear is yours — each is a switch in the route behind the tile,
 * because the right answer differs between a phone in your hand and a screen on
 * a wall you glance at.
 */

/** How many hours the strip shows. Eight fits the narrowest sensible tile. */
const STRIP_HOURS = 8

/**
 * The report's own clock, not the wall clock.
 *
 * `fetchedAt` moves on every tick, so the strip still advances — and
 * rendering stays a pure function of the data, which reading `Date.now()` mid
 * render would not be.
 */
function upcomingHours(report: WeatherReport, count: number): WeatherHour[] {
  const start = report.hourly.findIndex((hour) => hour.at >= report.fetchedAt)
  const from = start === -1 ? 0 : start
  return report.hourly.slice(from, from + count)
}

function Now({ report, unit }: { report: WeatherReport; unit: TemperatureUnit }) {
  const { label, icon } = describeCode(report.now.code, report.now.isDay)

  return (
    <div className="flex items-center gap-3">
      <WeatherIcon name={icon} className="text-accent text-3xl" />
      <div className="min-w-0">
        <p className="font-mono text-3xl leading-none tabular-nums">
          {formatTemp(report.now.tempC, unit)}
        </p>
        <p className="text-ink-dim truncate text-xs">{label}</p>
      </div>
    </div>
  )
}

function Today({ report, unit }: { report: WeatherReport; unit: TemperatureUnit }) {
  const today = report.daily[0]
  if (!today) return null

  return (
    <p className="text-ink-dim font-mono text-xs tabular-nums">
      <span className="text-ink">{formatTemp(today.maxC, unit)}</span> high ·{' '}
      <span className="text-ink">{formatTemp(today.minC, unit)}</span> low · feels{' '}
      {formatTemp(report.now.feelsC, unit)}
    </p>
  )
}

function Rain({ report }: { report: WeatherReport }) {
  const outlook = rainOutlook(report.hourly, report.fetchedAt)

  if (!outlook.willRain) {
    return (
      <p className="text-ink-dim text-xs">
        No rain expected · peak {Math.round(outlook.peakChance)}%
      </p>
    )
  }

  const when =
    outlook.startsInHours === null
      ? 'soon'
      : outlook.startsInHours === 0
        ? 'this hour'
        : `in ${outlook.startsInHours}h`

  return (
    <p className="text-accent text-xs font-medium">
      Rain {when} · {Math.round(outlook.peakChance)}% chance
    </p>
  )
}

function Hourly({ report, unit }: { report: WeatherReport; unit: TemperatureUnit }) {
  const hours = upcomingHours(report, STRIP_HOURS)
  if (hours.length === 0) return null

  return (
    <ul className="flex items-end justify-between gap-1">
      {hours.map((hour) => {
        const { icon } = describeCode(hour.code)
        return (
          <li key={hour.time} className="flex min-w-0 flex-1 flex-col items-center gap-0.5">
            <span className="text-ink-dim font-mono text-[0.55rem] tabular-nums">
              {shortHour(hour.time)}
            </span>
            <WeatherIcon name={icon} className="text-ink-dim text-sm" />
            <span className="font-mono text-[0.6rem] tabular-nums">
              {formatTemp(hour.tempC, unit)}
            </span>
            {/* Rain probability as a hairline under each hour — colour alone
                would be the only carrier otherwise, and this has to survive a
                display with none. */}
            <span className="bg-line block h-0.5 w-full">
              <span
                className={`block h-full ${
                  hour.rainChance >= RAIN_THRESHOLD ? 'bg-accent' : 'bg-ink-dim/40'
                }`}
                style={{ width: `${hour.rainChance}%` }}
              />
            </span>
          </li>
        )
      })}
    </ul>
  )
}

function Forecast({
  days,
  unit,
  todayIso,
}: {
  days: WeatherDay[]
  unit: TemperatureUnit
  todayIso: string
}) {
  // One shared scale across the whole block, so a taller bar really is a warmer
  // day rather than each row being normalised to itself.
  const lo = Math.min(...days.map((day) => day.minC))
  const hi = Math.max(...days.map((day) => day.maxC))
  const span = Math.max(1, hi - lo)

  return (
    <ul className="flex flex-col gap-0.5">
      {days.map((day) => {
        const { icon } = describeCode(day.code)
        const left = ((day.minC - lo) / span) * 100
        const width = Math.max(4, ((day.maxC - day.minC) / span) * 100)

        return (
          <li key={day.date} className="flex items-center gap-1.5">
            <span className="text-ink-dim w-8 shrink-0 font-mono text-[0.6rem]">
              {shortDay(day.date, todayIso)}
            </span>
            <WeatherIcon name={icon} className="text-ink-dim shrink-0 text-xs" />
            <span className="text-ink-dim w-7 shrink-0 text-right font-mono text-[0.6rem] tabular-nums">
              {formatTemp(day.minC, unit)}
            </span>
            <span className="bg-line relative h-1 min-w-0 flex-1">
              <span
                className="bg-accent absolute h-full"
                style={{ left: `${left}%`, width: `${width}%` }}
              />
            </span>
            <span className="w-7 shrink-0 font-mono text-[0.6rem] tabular-nums">
              {formatTemp(day.maxC, unit)}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

function Tile() {
  const weather = usePolled('slow', getWeather)

  if (weather.status === 'loading') return <p className="text-ink-dim text-sm">loading…</p>
  if (weather.status === 'error') return <p className="text-danger text-sm">{weather.message}</p>

  const { report, settings, needsLocation } = weather.data

  if (needsLocation || !report) {
    return <p className="text-ink-dim text-sm italic">No location set yet — tap to pick one.</p>
  }

  const { unit, tile } = settings
  const todayIso = report.daily[0]?.date ?? ''
  const on = (section: Section) => tile[section]

  // Both forecast lengths on at once would be two lists of the same thing; the
  // longer one wins and the settings screen keeps them mutually exclusive.
  const forecastDays = on('daily10') ? 10 : on('daily5') ? 5 : 0

  return (
    <div className="flex h-full flex-col gap-2 overflow-hidden">
      {on('now') && <Now report={report} unit={unit} />}
      {on('today') && <Today report={report} unit={unit} />}
      {on('rain') && <Rain report={report} />}
      {on('hourly') && <Hourly report={report} unit={unit} />}
      {forecastDays > 0 && (
        <Forecast days={report.daily.slice(0, forecastDays)} unit={unit} todayIso={todayIso} />
      )}

      <p className="text-ink-dim mt-auto truncate font-mono text-[0.55rem]">
        {report.location.name}
      </p>
    </div>
  )
}

export default defineTool({
  meta,
  tier: 'slow',
  Tile,
  View: Config,
})
