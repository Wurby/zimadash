/**
 * Weather — types, unit conversion and the WMO code table, imported by BOTH
 * sides.
 *
 * Temperatures travel as Celsius and are converted for display, so the server
 * cache holds one copy whatever unit the tile is set to.
 *
 * Keep this free of Node built-ins and browser globals; the frontend reaches it
 * through the `@shared/*` alias.
 */

/** The blocks the tile can show, in the order they render. Each is toggled on
 *  its own. */
export const SECTIONS = ['now', 'today', 'rain', 'hourly', 'daily5', 'daily10'] as const;
export type Section = (typeof SECTIONS)[number];

export const SECTION_LABELS: Record<Section, string> = {
  now: 'Now',
  today: "Today's high and low",
  rain: 'Is it going to rain',
  hourly: 'Hourly strip',
  daily5: '5-day forecast',
  daily10: '10-day forecast',
};

/** The two forecast lengths are one choice wearing two switches — turning one
 *  on turns the other off. */
export const DAILY_SECTIONS: Section[] = ['daily5', 'daily10'];

export type TemperatureUnit = 'celsius' | 'fahrenheit';

export interface WeatherLocation {
  name: string;
  latitude: number;
  longitude: number;
}

export interface WeatherSettings {
  /** Null until you've picked one — the tool says so rather than guessing. */
  location: WeatherLocation | null;
  unit: TemperatureUnit;
  tile: Record<Section, boolean>;
}

export const DEFAULT_SETTINGS: WeatherSettings = {
  location: null,
  unit: 'celsius',
  tile: { now: true, today: true, rain: true, hourly: true, daily5: false, daily10: false },
};

export interface WeatherNow {
  tempC: number;
  feelsC: number;
  code: number;
  isDay: boolean;
  windKph: number;
  humidity: number;
}

export interface WeatherHour {
  /**
   * Wall-clock time *at the location*, as Open-Meteo returns it under
   * `timezone=auto` — e.g. 2026-08-09T14:00, with no offset on it. Use this for
   * display and never for comparison: `new Date()` reads an offset-less string
   * in the *viewer's* zone, which is only the same thing while you're looking
   * at your own weather.
   */
  time: string;
  /** The same instant as a real epoch, resolved server-side from the
   *  location's UTC offset. This is the one to compare against. */
  at: number;
  tempC: number;
  code: number;
  rainChance: number;
}

export interface WeatherDay {
  date: string;
  minC: number;
  maxC: number;
  code: number;
  rainChance: number;
}

export interface WeatherReport {
  location: WeatherLocation;
  now: WeatherNow;
  hourly: WeatherHour[];
  daily: WeatherDay[];
  fetchedAt: number;
}

/** How many days the long forecast runs to. Open-Meteo will go to 16. */
export const FORECAST_DAYS = 10;

/** How far ahead "is it going to rain" looks. */
export const RAIN_WINDOW_HOURS = 12;

/** The probability at which it's worth mentioning. Below this, saying "rain"
 *  costs you more in coats than it saves. */
export const RAIN_THRESHOLD = 40;

export function toDisplay(celsius: number, unit: TemperatureUnit): number {
  return unit === 'fahrenheit' ? celsius * 1.8 + 32 : celsius;
}

export function unitSuffix(unit: TemperatureUnit): string {
  return unit === 'fahrenheit' ? '°F' : '°C';
}

/** Rounded, with the degree sign — what actually goes on screen. */
export function formatTemp(celsius: number, unit: TemperatureUnit): string {
  return `${Math.round(toDisplay(celsius, unit))}°`;
}

export interface RainOutlook {
  willRain: boolean;
  /** Highest chance in the window, 0–100. */
  peakChance: number;
  /** Hours until the first hour over the threshold, or null if none is. */
  startsInHours: number | null;
}

/**
 * Whether rain is worth mentioning in the next few hours.
 *
 * Reads the hourly probabilities rather than the daily maximum: a 70% chance at
 * 11pm is not an answer to "do I need a coat now", and the daily figure can't
 * tell those apart.
 */
export function rainOutlook(hours: WeatherHour[], now: number): RainOutlook {
  const upcoming = hours
    .filter((hour) => hour.at >= now - 3_600_000)
    .slice(0, RAIN_WINDOW_HOURS);

  if (upcoming.length === 0) return { willRain: false, peakChance: 0, startsInHours: null };

  let peakChance = 0;
  let startsInHours: number | null = null;

  upcoming.forEach((hour, offset) => {
    peakChance = Math.max(peakChance, hour.rainChance);
    if (startsInHours === null && hour.rainChance >= RAIN_THRESHOLD) startsInHours = offset;
  });

  return { willRain: peakChance >= RAIN_THRESHOLD, peakChance, startsInHours };
}

/**
 * WMO weather codes, as Open-Meteo reports them.
 *
 * `icon` names a glyph in the tool's own icon set — weather icons live with the
 * tool rather than in `components/Icon.tsx` so the whole thing stays liftable
 * into its own repo.
 */
const CODES: Record<number, { label: string; icon: string }> = {
  0: { label: 'Clear', icon: 'clear' },
  1: { label: 'Mainly clear', icon: 'clear' },
  2: { label: 'Partly cloudy', icon: 'partly' },
  3: { label: 'Overcast', icon: 'cloud' },
  45: { label: 'Fog', icon: 'fog' },
  48: { label: 'Rime fog', icon: 'fog' },
  51: { label: 'Light drizzle', icon: 'drizzle' },
  53: { label: 'Drizzle', icon: 'drizzle' },
  55: { label: 'Heavy drizzle', icon: 'drizzle' },
  56: { label: 'Freezing drizzle', icon: 'drizzle' },
  57: { label: 'Freezing drizzle', icon: 'drizzle' },
  61: { label: 'Light rain', icon: 'rain' },
  63: { label: 'Rain', icon: 'rain' },
  65: { label: 'Heavy rain', icon: 'rain' },
  66: { label: 'Freezing rain', icon: 'rain' },
  67: { label: 'Freezing rain', icon: 'rain' },
  71: { label: 'Light snow', icon: 'snow' },
  73: { label: 'Snow', icon: 'snow' },
  75: { label: 'Heavy snow', icon: 'snow' },
  77: { label: 'Snow grains', icon: 'snow' },
  80: { label: 'Light showers', icon: 'rain' },
  81: { label: 'Showers', icon: 'rain' },
  82: { label: 'Heavy showers', icon: 'rain' },
  85: { label: 'Snow showers', icon: 'snow' },
  86: { label: 'Snow showers', icon: 'snow' },
  95: { label: 'Thunderstorm', icon: 'storm' },
  96: { label: 'Thunderstorm, hail', icon: 'storm' },
  99: { label: 'Thunderstorm, hail', icon: 'storm' },
};

export function describeCode(code: number, isDay = true): { label: string; icon: string } {
  const found = CODES[code] ?? { label: 'Unknown', icon: 'cloud' };
  // The only glyph with a night form — everything else looks the same after
  // dark, and a crescent behind a raincloud reads as clutter at tile size.
  if (found.icon === 'clear' && !isDay) return { label: found.label, icon: 'clear-night' };
  return found;
}

/** "Mon", "Tue" — the axis label for a forecast column. */
export function shortDay(iso: string, todayIso: string): string {
  if (iso === todayIso) return 'Today';
  const [year, month, day] = iso.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { weekday: 'short' });
}

/**
 * "14" — the axis label for an hourly column.
 *
 * Built from the string's own parts rather than by parsing it, so the column
 * reads as the hour it is *where the weather is*, formatted the way the viewer
 * writes hours. Parsing would silently shift it into the viewer's zone.
 */
export function shortHour(time: string): string {
  const [date, clock] = time.split('T');
  const [year, month, day] = (date ?? '').split('-').map(Number) as [number, number, number];
  const hour = Number((clock ?? '').split(':')[0]);
  if (!Number.isFinite(hour)) return '';

  return new Date(year, month - 1, day, hour)
    .toLocaleTimeString(undefined, { hour: 'numeric' })
    .replace(/\s/g, '');
}
