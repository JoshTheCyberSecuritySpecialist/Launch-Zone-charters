import { env } from '../config/env';

export type MarineLocationKey = 'daytona' | 'titusville';

export type MarineAlert = {
  event: string;
  headline: string;
  description: string;
  severity: string;
  areaDesc?: string;
};

export type MarineConditionsOk = {
  success: true;
  windSpeed: number | null;
  windDirection: string | null;
  waveHeightFt: number | null;
  waterTempF: number | null;
  airTempF: number | null;
  shortForecast: string | null;
  tideSummary?: string | null;
  nextHighTide?: { time: string | null; heightFt: number } | null;
  nextLowTide?: { time: string | null; heightFt: number } | null;
  forecast: string;
  alerts: MarineAlert[];
  status: string;
  statusLevel: string;
  source: string;
  timestamp: string;
  locationLabel: string;
  cached?: boolean;
};

export type MarineConditionsFail = {
  success: false;
  error: string;
  timestamp?: string;
  source?: string;
  locationLabel?: string;
};

export type MarineConditionsResponse = MarineConditionsOk | MarineConditionsFail;

export const LIVE_DATA_UNAVAILABLE = 'Live data temporarily unavailable';
const MARINE_FETCH_TIMEOUT_MS = 7000;

/** Map booking departure text to marine-conditions API location keys. */
export function marineLocationKeyFromRentalLocation(location: string | null | undefined): MarineLocationKey {
  const text = String(location || '').trim().toLowerCase();
  if (text.includes('titusville') || text.includes('space coast') || text.includes('canaveral')) {
    return 'titusville';
  }
  return 'daytona';
}

export function marineGoLabel(statusLevel: string | null | undefined): string {
  if (statusLevel === 'rough') return 'No-go';
  if (statusLevel === 'moderate') return 'Good';
  if (statusLevel === 'excellent') return 'Prime';
  return 'Check';
}

export function marineGoTone(statusLevel: string | null | undefined): 'success' | 'warning' | 'danger' | 'neutral' {
  if (statusLevel === 'rough') return 'danger';
  if (statusLevel === 'moderate') return 'warning';
  if (statusLevel === 'excellent') return 'success';
  return 'neutral';
}

function formatWind(speed: number | null, direction: string | null): string | null {
  if (speed == null || Number.isNaN(speed)) return null;
  const mph = speed >= 10 ? speed.toFixed(0) : speed.toFixed(1);
  return direction ? `${mph} mph ${direction}` : `${mph} mph`;
}

function formatFt(value: number | null | undefined): string | null {
  if (value == null || Number.isNaN(value)) return null;
  return `${value.toFixed(1)} ft`;
}

function formatTempF(value: number | null | undefined): string | null {
  if (value == null || Number.isNaN(value)) return null;
  return `${Math.round(value)}°F`;
}

export type MarineConditionsSummary = {
  wind: string | null;
  waves: string | null;
  airTemp: string | null;
  waterTemp: string | null;
  forecast: string | null;
  goLabel: string;
  statusLevel: string | null;
  locationLabel: string;
  alertCount: number;
};

export function summarizeMarineConditions(data: MarineConditionsOk): MarineConditionsSummary {
  return {
    wind: formatWind(data.windSpeed, data.windDirection),
    waves: formatFt(data.waveHeightFt),
    airTemp: formatTempF(data.airTempF),
    waterTemp: formatTempF(data.waterTempF),
    forecast: data.shortForecast || data.forecast || null,
    goLabel: marineGoLabel(data.statusLevel),
    statusLevel: data.statusLevel || null,
    locationLabel: data.locationLabel,
    alertCount: Array.isArray(data.alerts) ? data.alerts.length : 0,
  };
}

export async function fetchMarineConditions(locationKey: MarineLocationKey): Promise<MarineConditionsResponse> {
  if (!env.apiUrlConfigured || !env.apiUrl) {
    return { success: false, error: LIVE_DATA_UNAVAILABLE };
  }

  const ac = new AbortController();
  const timer = window.setTimeout(() => ac.abort(), MARINE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${env.apiUrl}/api/marine-conditions?location=${locationKey}`, {
      method: 'GET',
      signal: ac.signal,
    });
    const text = await res.text();
    const json = text ? (JSON.parse(text) as MarineConditionsResponse) : ({ success: false, error: LIVE_DATA_UNAVAILABLE } as MarineConditionsFail);

    if (!res.ok || !json || typeof json !== 'object' || !('success' in json)) {
      const err =
        json && typeof json === 'object' && 'error' in json && typeof (json as MarineConditionsFail).error === 'string'
          ? (json as MarineConditionsFail).error
          : LIVE_DATA_UNAVAILABLE;
      return { success: false, error: err };
    }

    return json;
  } catch {
    return { success: false, error: LIVE_DATA_UNAVAILABLE };
  } finally {
    window.clearTimeout(timer);
  }
}
