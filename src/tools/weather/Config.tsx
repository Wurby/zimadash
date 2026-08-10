import { useState } from 'react'
import {
  DAILY_SECTIONS,
  SECTIONS,
  SECTION_LABELS,
  type Section,
  type TemperatureUnit,
  type WeatherLocation,
  type WeatherSettings,
} from '@shared/weather'
import { usePolled } from '../../lib/refresh'
import { getSettings, putSettings, searchPlaces } from './api'

/**
 * The route behind the tile: configuration only.
 *
 * The location is searched by name rather than typed as coordinates — and it is
 * stored server-side in DATA_DIR, not in this repo, because where you live is
 * personal and the repo is public.
 */

const UNITS: { value: TemperatureUnit; label: string }[] = [
  { value: 'celsius', label: '°C' },
  { value: 'fahrenheit', label: '°F' },
]

function LocationPicker({
  current,
  onPick,
}: {
  current: WeatherLocation | null
  onPick: (location: WeatherLocation) => Promise<void>
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<WeatherLocation[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function search(event: React.FormEvent) {
    event.preventDefault()
    if (query.trim().length < 2) return

    setSearching(true)
    setError(null)
    try {
      const found = await searchPlaces(query.trim())
      setResults(found.results)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'could not search')
    } finally {
      setSearching(false)
    }
  }

  return (
    <section>
      <h2 className="text-sm font-semibold tracking-tight">Location</h2>
      <p className="text-ink-dim mt-1 text-xs">
        {current ? (
          <>
            Currently <span className="text-ink font-medium">{current.name}</span>.
          </>
        ) : (
          'Nothing set — the tile has nowhere to report on until you pick somewhere.'
        )}
      </p>

      <form onSubmit={search} className="mt-3 flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1">
          <span className="text-ink-dim text-xs">Search for a place</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Town or city"
            className="border-line focus:border-accent mt-1 w-full border bg-transparent px-2 py-1.5 text-sm outline-none"
          />
        </label>
        <button
          type="submit"
          disabled={searching || query.trim().length < 2}
          className="border-accent text-accent hover:bg-accent/10 border px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40"
        >
          {searching ? 'searching…' : 'search'}
        </button>
      </form>

      {error && <p className="text-danger mt-2 text-xs">{error}</p>}

      {results !== null && results.length === 0 && (
        <p className="text-ink-dim mt-2 text-xs italic">Nothing found for that.</p>
      )}

      {results !== null && results.length > 0 && (
        <ul className="mt-3 space-y-1">
          {results.map((place) => (
            <li key={`${place.latitude},${place.longitude}`}>
              <button
                type="button"
                onClick={() => {
                  void onPick(place)
                  setResults(null)
                  setQuery('')
                }}
                className="border-line bg-surface hover:border-accent hover:text-accent w-full border px-3 py-2 text-left text-sm transition-colors"
              >
                {place.name}
                <span className="text-ink-dim ml-2 font-mono text-xs">
                  {place.latitude.toFixed(2)}, {place.longitude.toFixed(2)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function Config() {
  const loaded = usePolled('event-driven', getSettings)
  const [override, setOverride] = useState<WeatherSettings | null>(null)
  const [error, setError] = useState<string | null>(null)

  const settings = override ?? (loaded.status === 'ok' ? loaded.data : null)

  async function save(patch: Partial<WeatherSettings>) {
    setError(null)
    try {
      setOverride(await putSettings(patch))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'could not save that')
    }
  }

  function toggleSection(section: Section, on: boolean) {
    if (!settings) return
    const tile = { ...settings.tile, [section]: on }

    // The two forecast lengths are one choice wearing two switches — turning
    // one on turns the other off, rather than stacking two lists of the same
    // days on the tile.
    if (on && DAILY_SECTIONS.includes(section)) {
      for (const other of DAILY_SECTIONS) {
        if (other !== section) tile[other] = false
      }
    }

    void save({ tile })
  }

  if (loaded.status === 'loading' && !settings) {
    return <p className="text-ink-dim text-sm">loading…</p>
  }
  if (loaded.status === 'error' && !settings) {
    return <p className="text-danger text-sm">{loaded.message}</p>
  }
  if (!settings) return null

  return (
    <div className="space-y-6">
      <LocationPicker
        current={settings.location}
        onPick={(location) => save({ location })}
      />

      <section>
        <h2 className="text-sm font-semibold tracking-tight">Units</h2>
        <div className="mt-3 flex gap-2">
          {UNITS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => void save({ unit: option.value })}
              aria-pressed={settings.unit === option.value}
              className={`border px-4 py-1.5 font-mono text-sm transition-colors ${
                settings.unit === option.value
                  ? 'border-accent text-accent'
                  : 'border-line text-ink-dim hover:border-accent'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold tracking-tight">What shows on the tile</h2>
        <p className="text-ink-dim mt-1 text-xs">
          Turn off what you don't read. The tile clips what doesn't fit, so if you want everything,
          give it a bigger size from the dashboard's edit mode.
        </p>

        <ul className="mt-3 space-y-1">
          {SECTIONS.map((section) => (
            <li key={section}>
              <label className="border-line bg-surface flex cursor-pointer items-center gap-3 border px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={settings.tile[section]}
                  onChange={(event) => toggleSection(section, event.target.checked)}
                  className="accent-accent"
                />
                {SECTION_LABELS[section]}
              </label>
            </li>
          ))}
        </ul>
      </section>

      {error && <p className="text-danger text-xs">{error}</p>}
    </div>
  )
}
