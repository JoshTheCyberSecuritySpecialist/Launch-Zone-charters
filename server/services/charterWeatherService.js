/**
 * Time-window charter forecast. Reuses operating locations + NWS alerts + Open-Meteo.
 * Does not cancel or approve charters. Secrets stay on the server.
 */

const fetch = require('node-fetch');
const { resolveOperatingLocation } = require('../lib/operatingLocations');
const { buildCharterWeatherOutlook } = require('../lib/charterWeatherOutlook');
const {
  aggregateWindowHours,
  collectWindowHours,
  marineSeriesByTime,
  resolveCharterWeatherWindow,
} = require('../lib/charterWeatherWindow');

const FETCH_TIMEOUT_MS = 6500;
const CACHE_TTL_MS = 10 * 60 * 1000;
const NOAA_USER_AGENT = '(Launch Zone Charters, https://launchzonecharters.com)';
const cacheByKey = new Map();

function cToF(c) {
  if (c == null || Number.isNaN(Number(c))) return null;
  return Number(c) * (9 / 5) + 32;
}

function mToFt(m) {
  if (m == null || Number.isNaN(Number(m))) return null;
  return Number(m) * 3.28084;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    const aborted =
      err?.name === 'AbortError' ||
      (typeof err?.message === 'string' && err.message.toLowerCase().includes('abort'));
    if (aborted) {
      const t = new Error(`Request timed out after ${FETCH_TIMEOUT_MS}ms`);
      t.cause = err;
      throw t;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function noaaHeaders() {
  return {
    'User-Agent': NOAA_USER_AGENT,
    Accept: 'application/geo+json, application/json',
  };
}

function normalizeAlerts(alertsJson) {
  const features = Array.isArray(alertsJson?.features) ? alertsJson.features : [];
  return features.map((f) => {
    const p = f?.properties || {};
    const id = typeof p.id === 'string' ? p.id : '';
    return {
      event: p.event || 'Alert',
      headline: p.headline || p.event || '',
      description: (p.description || '').trim(),
      severity: p.severity || '',
      areaDesc: p.areaDesc || '',
      effective: p.effective || null,
      expires: p.expires || null,
      officialUrl: /^https?:\/\//i.test(id) ? id : 'https://www.weather.gov',
    };
  });
}

async function fetchNoaaAlerts(location) {
  const url = `https://api.weather.gov/alerts/active?status=actual&point=${location.lat},${location.lon}`;
  const res = await fetchWithTimeout(url, { headers: noaaHeaders() });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.detail || `NOAA alerts HTTP ${res.status}`);
  }
  return normalizeAlerts(json);
}

async function fetchOpenMeteoJson(url, label) {
  const res = await fetchWithTimeout(url);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Open-Meteo ${label} HTTP ${res.status}`);
  }
  return json;
}

function windowDateSpan(window) {
  const startDate = window.startDateTime.toFormat('yyyy-MM-dd');
  const endDate = window.endDateTime.toFormat('yyyy-MM-dd');
  return { startDate, endDate };
}

async function fetchHourlyForecast(location, window) {
  const { startDate, endDate } = windowDateSpan(window);
  const q = new URLSearchParams({
    latitude: String(location.lat),
    longitude: String(location.lon),
    hourly:
      'temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,visibility,cloud_cover,relative_humidity_2m',
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    precipitation_unit: 'inch',
    timezone: location.timeZone,
    start_date: startDate,
    end_date: endDate,
  });
  return fetchOpenMeteoJson(`https://api.open-meteo.com/v1/forecast?${q}`, 'forecast');
}

async function fetchMarineHourly(location, window) {
  const { startDate, endDate } = windowDateSpan(window);
  const q = new URLSearchParams({
    latitude: String(location.lat),
    longitude: String(location.lon),
    hourly: 'wave_height,sea_surface_temperature',
    timezone: location.timeZone,
    start_date: startDate,
    end_date: endDate,
  });
  return fetchOpenMeteoJson(`https://marine-api.open-meteo.com/v1/marine?${q}`, 'marine');
}

function cacheKey(locationId, window) {
  return `${locationId}|${window.date}|${window.startTime}|${window.durationMinutes}`;
}

/**
 * @returns {Promise<object>}
 */
async function getCharterWeatherWindow(options = {}) {
  const resolved = resolveOperatingLocation(options.locationKey, { defaultKey: null });
  if (!resolved.ok || !options.locationKey) {
    return { success: false, statusCode: 400, error: 'Unknown location' };
  }
  const location = resolved.location;
  const window = resolveCharterWeatherWindow({
    date: options.date,
    startTime: options.startTime,
    durationMinutes: options.durationMinutes,
  });
  if (!window.ok) {
    return { success: false, statusCode: 400, error: window.error };
  }

  const key = cacheKey(location.id, window);
  const cached = cacheByKey.get(key);
  if (cached?.payload && cached.expires > Date.now()) {
    return { ...cached.payload, cached: true, stale: Boolean(cached.payload.stale) };
  }

  let hourlyJson = null;
  let marineJson = null;
  let alerts = [];
  const sources = [];
  const warnings = [];

  const tasks = [
    fetchHourlyForecast(location, window)
      .then((json) => {
        hourlyJson = json;
        sources.push({ name: 'Open-Meteo', usedFor: 'hourly forecast' });
      })
      .catch((err) => {
        warnings.push('Hourly forecast is temporarily unavailable.');
        console.warn('[charter-weather] forecast failed:', err?.message || err);
      }),
    fetchMarineHourly(location, window)
      .then((json) => {
        marineJson = json;
        sources.push({ name: 'Open-Meteo Marine', usedFor: 'waves and water temperature' });
      })
      .catch((err) => {
        warnings.push('Marine wave data is temporarily unavailable.');
        console.warn('[charter-weather] marine failed:', err?.message || err);
      }),
    fetchNoaaAlerts(location)
      .then((list) => {
        alerts = list;
        sources.push({ name: 'National Weather Service', usedFor: 'active alerts' });
      })
      .catch((err) => {
        warnings.push('National Weather Service alerts are temporarily unavailable.');
        console.warn('[charter-weather] alerts failed:', err?.message || err);
      }),
  ];

  await Promise.all(tasks);

  const extras = {
    waveByTime: marineSeriesByTime(marineJson?.hourly, 'wave_height', mToFt),
    waterTempByTime: marineSeriesByTime(marineJson?.hourly, 'sea_surface_temperature', cToF),
  };
  const hourly = collectWindowHours(hourlyJson?.hourly || {}, window, extras);
  const summary = aggregateWindowHours(hourly);
  const outlook = buildCharterWeatherOutlook({
    precipChancePct: summary.precipChancePct,
    precipIn: summary.precipIn,
    windMph: summary.windMph,
    gustMph: summary.gustMph,
    visibilityMi: summary.visibilityMi,
    alerts,
    hourlyCount: hourly.length,
  });

  const payload = {
    success: true,
    location: {
      id: location.id,
      name: location.name,
      label: location.label,
      timeZone: location.timeZone,
    },
    requestedWindow: {
      start: window.startIso,
      end: window.endIso,
      date: window.date,
      startTime: window.startTime,
      durationMinutes: window.durationMinutes,
      crossesMidnight: window.crossesMidnight,
      label: window.label,
    },
    hourly,
    window: summary,
    alerts,
    outlook,
    sources,
    updatedAt: new Date().toISOString(),
    stale: false,
    warnings,
  };

  if (!hourly.length && !alerts.length) {
    return {
      success: false,
      statusCode: 503,
      error: 'Forecast not yet available for that time.',
      outlook: {
        level: 'unavailable',
        label: 'Forecast not yet available',
        reasons: ['Hourly forecast data is not available for this time yet.'],
      },
      location: payload.location,
      requestedWindow: payload.requestedWindow,
      updatedAt: payload.updatedAt,
    };
  }

  cacheByKey.set(key, { expires: Date.now() + CACHE_TTL_MS, payload });
  return { ...payload, cached: false };
}

module.exports = {
  CACHE_TTL_MS,
  getCharterWeatherWindow,
};
