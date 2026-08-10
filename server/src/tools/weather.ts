import { Router } from 'express';
import { readJson, writeJson } from '../paths.js';
import type { ServerTool } from './registry.js';
import { intervalFor } from '../shared/tiers.js';
import {
  DEFAULT_SETTINGS,
  FORECAST_DAYS,
  SECTIONS,
  type Section,
  type WeatherDay,
  type WeatherHour,
  type WeatherReport,
  type WeatherSettings,
} from '../shared/weather.js';

/**
 * Weather — everything under /api/tools/weather.
 *
 * Open-Meteo needs no key, which sidesteps the credential problem entirely.
 * The location is still personal, so it lives in DATA_DIR and never in a
 * tracked file — this repo is public.
 *
 * The only outbound hosts are the two constants below. Nothing a request can
 * carry chooses a host, only query parameters on a fixed one.
 */

const FILE = 'tool-weather.json';

const FORECAST_HOST = 'https://api.open-meteo.com/v1/forecast';
const GEOCODE_HOST = 'https://geocoding-api.open-meteo.com/v1/search';

const TIMEOUT_MS = 10_000;

/**
 * Cache lifetime, taken from the tier the tool polls on so it can never end up
 * slower than the clients reading it — a longer TTL here would have the tile
 * re-fetching values that cannot have changed.
 *
 * `slow` rather than `ambient`: the forecast models update every few minutes at
 * best, so a 60s cache was spending roughly 1,400 upstream calls a day to
 * re-fetch a number that could not have moved.
 */
const TTL_MS = intervalFor('slow') ?? 900_000;

interface CacheEntry {
  report: WeatherReport;
  at: number;
}

const cache = new Map<string, CacheEntry>();

const router = Router();

// ─── Settings ────────────────────────────────────────────────────────────────

function readSettings(): WeatherSettings {
  const stored = readJson<Partial<WeatherSettings>>(FILE);
  if (!stored) return DEFAULT_SETTINGS;

  const tile = { ...DEFAULT_SETTINGS.tile };
  for (const section of SECTIONS) {
    if (typeof stored.tile?.[section] === 'boolean') tile[section] = stored.tile[section];
  }

  return {
    location: stored.location ?? null,
    unit: stored.unit === 'fahrenheit' ? 'fahrenheit' : 'celsius',
    tile,
  };
}

function validLatitude(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= -90 && value <= 90;
}

function validLongitude(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= -180 && value <= 180;
}

router.get('/settings', (_req, res) => {
  res.json(readSettings());
});

router.put('/settings', (req, res) => {
  const current = readSettings();
  const next: WeatherSettings = { ...current, tile: { ...current.tile } };

  if (req.body?.location !== undefined) {
    if (req.body.location === null) {
      next.location = null;
    } else {
      const { name, latitude, longitude } = req.body.location ?? {};
      if (typeof name !== 'string' || !name.trim() || name.length > 120) {
        res.status(400).json({ error: 'location.name must be 1–120 characters' });
        return;
      }
      if (!validLatitude(latitude) || !validLongitude(longitude)) {
        res.status(400).json({ error: 'location must carry a real latitude and longitude' });
        return;
      }
      next.location = { name: name.trim(), latitude, longitude };
    }
  }

  if (req.body?.unit !== undefined) {
    if (req.body.unit !== 'celsius' && req.body.unit !== 'fahrenheit') {
      res.status(400).json({ error: 'unit must be celsius or fahrenheit' });
      return;
    }
    next.unit = req.body.unit;
  }

  if (req.body?.tile !== undefined) {
    for (const section of SECTIONS) {
      const value: unknown = req.body.tile?.[section];
      if (value === undefined) continue;
      if (typeof value !== 'boolean') {
        res.status(400).json({ error: `tile.${section} must be a boolean` });
        return;
      }
      next.tile[section as Section] = value;
    }
  }

  writeJson(FILE, next);
  res.json(next);
});

// ─── Geocoding ───────────────────────────────────────────────────────────────

interface GeocodeResult {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  admin1?: string;
}

/** Typing a place name beats typing coordinates, and this is the only way to
 *  get from one to the other without shipping a gazetteer. */
router.get('/search', async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';

  if (query.length < 2) {
    res.json({ results: [] });
    return;
  }

  const url = new URL(GEOCODE_HOST);
  url.searchParams.set('name', query.slice(0, 120));
  url.searchParams.set('count', '6');
  url.searchParams.set('language', 'en');
  url.searchParams.set('format', 'json');

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`geocoding returned ${response.status}`);

    const body = (await response.json()) as { results?: GeocodeResult[] };
    const results = (body.results ?? [])
      .filter((hit) => validLatitude(hit.latitude) && validLongitude(hit.longitude))
      .map((hit) => ({
        name: [hit.name, hit.admin1, hit.country].filter(Boolean).join(', '),
        latitude: hit.latitude,
        longitude: hit.longitude,
      }));

    res.json({ results });
  } catch (err) {
    res.status(502).json({ error: `could not search for a place: ${(err as Error).message}` });
  }
});

// ─── The forecast ────────────────────────────────────────────────────────────

interface OpenMeteoResponse {
  /** Seconds east of UTC for the location, under `timezone=auto`. The only way
   *  to turn the offset-less local timestamps into real instants. */
  utc_offset_seconds?: number;
  current?: {
    temperature_2m: number;
    apparent_temperature: number;
    is_day: number;
    weather_code: number;
    wind_speed_10m: number;
    relative_humidity_2m: number;
  };
  hourly?: {
    time: string[];
    temperature_2m: number[];
    weather_code: number[];
    precipitation_probability: (number | null)[];
  };
  daily?: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max: (number | null)[];
  };
}

async function fetchReport(location: NonNullable<WeatherSettings['location']>): Promise<WeatherReport> {
  const url = new URL(FORECAST_HOST);
  url.searchParams.set('latitude', String(location.latitude));
  url.searchParams.set('longitude', String(location.longitude));
  url.searchParams.set(
    'current',
    'temperature_2m,apparent_temperature,is_day,weather_code,wind_speed_10m,relative_humidity_2m',
  );
  url.searchParams.set('hourly', 'temperature_2m,weather_code,precipitation_probability');
  url.searchParams.set(
    'daily',
    'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
  );
  // Everything comes back as Celsius and is converted for display, so one
  // cached copy serves the tile whichever unit it is set to.
  url.searchParams.set('temperature_unit', 'celsius');
  url.searchParams.set('wind_speed_unit', 'kmh');
  url.searchParams.set('timezone', 'auto');
  url.searchParams.set('forecast_days', String(FORECAST_DAYS));

  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`weather service returned ${response.status}`);

  const body = (await response.json()) as OpenMeteoResponse;
  if (!body.current || !body.hourly || !body.daily) {
    throw new Error('weather service sent an incomplete forecast');
  }

  // `timezone=auto` gives wall-clock times at the location with no offset on
  // them, so each one is resolved to a real instant here — once, on the way
  // through — rather than being parsed in whatever zone the browser is in.
  const offsetMs = (body.utc_offset_seconds ?? 0) * 1_000;

  const hourly: WeatherHour[] = body.hourly.time.map((time, index) => ({
    time,
    at: Date.parse(`${time}Z`) - offsetMs,
    tempC: body.hourly!.temperature_2m[index] ?? 0,
    code: body.hourly!.weather_code[index] ?? 0,
    rainChance: body.hourly!.precipitation_probability[index] ?? 0,
  }));

  const daily: WeatherDay[] = body.daily.time.map((date, index) => ({
    date,
    minC: body.daily!.temperature_2m_min[index] ?? 0,
    maxC: body.daily!.temperature_2m_max[index] ?? 0,
    code: body.daily!.weather_code[index] ?? 0,
    rainChance: body.daily!.precipitation_probability_max[index] ?? 0,
  }));

  return {
    location,
    now: {
      tempC: body.current.temperature_2m,
      feelsC: body.current.apparent_temperature,
      code: body.current.weather_code,
      isDay: body.current.is_day === 1,
      windKph: body.current.wind_speed_10m,
      humidity: body.current.relative_humidity_2m,
    },
    hourly,
    daily,
    fetchedAt: Date.now(),
  };
}

router.get('/', async (_req, res) => {
  const settings = readSettings();

  if (!settings.location) {
    // Not an error — a fresh install has nowhere to report on yet, and the tile
    // says so rather than showing a spinner forever.
    res.json({ report: null, settings, needsLocation: true });
    return;
  }

  const key = `${settings.location.latitude},${settings.location.longitude}`;
  const hit = cache.get(key);

  if (hit && Date.now() - hit.at < TTL_MS) {
    res.json({ report: hit.report, settings, needsLocation: false });
    return;
  }

  try {
    const report = await fetchReport(settings.location);
    cache.set(key, { report, at: Date.now() });
    res.json({ report, settings, needsLocation: false });
  } catch (err) {
    // A stale temperature that looks current is worse than a gap, so a failed
    // refresh is reported as one rather than quietly serving the old entry.
    res.status(502).json({ error: `could not reach the weather service: ${(err as Error).message}` });
  }
});

const tool: ServerTool = { slug: 'weather', router };
export default tool;
