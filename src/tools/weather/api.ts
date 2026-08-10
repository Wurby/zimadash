import type { WeatherLocation, WeatherReport, WeatherSettings } from '@shared/weather'
import { api } from '../../lib/api'

/** Every call this tool makes. Kept in one file so the tool stays liftable. */

const BASE = '/api/tools/weather'

export interface WeatherPayload {
  report: WeatherReport | null
  settings: WeatherSettings
  needsLocation: boolean
}

export function getWeather(): Promise<WeatherPayload> {
  return api<WeatherPayload>(BASE)
}

export function getSettings(): Promise<WeatherSettings> {
  return api<WeatherSettings>(`${BASE}/settings`)
}

export function putSettings(patch: Partial<WeatherSettings>): Promise<WeatherSettings> {
  return api<WeatherSettings>(`${BASE}/settings`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  })
}

export function searchPlaces(query: string): Promise<{ results: WeatherLocation[] }> {
  return api<{ results: WeatherLocation[] }>(`${BASE}/search?q=${encodeURIComponent(query)}`)
}
