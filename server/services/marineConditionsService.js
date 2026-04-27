/**
 * Hybrid marine conditions pipeline (audited):
 *
 * - NOAA api.weather.gov (required for authoritative NWS grid forecast + alerts):
 *   `GET /points/{lat},{lon}` → `properties.forecast`, and `alerts/active?point=`.
 *
 * - Open-Meteo (fallback / enrichment when NOAA is slow or partial):
 *   Marine API: wave_height, sea_surface_temperature.
 *   Forecast API: wind_speed_10m, wind_direction_10m (mph).
 *   Merge rule: if NOAA omits wind, use Open-Meteo hourly; waves/SST from marine API when available.
 *
 * All outbound HTTP uses fetchWithTimeout (see FETCH_TIMEOUT_MS). Per-source failures are
 * logged with console.warn; the handler returns success:false only when no usable field remains.
 */

const fetch = require('node-fetch');

/** Port Orange / Daytona Beach + Titusville / Space Coast */
const LOCATION_CONFIGS = {
  daytona: {
    key: 'daytona',
    lat: 29.1383,
    lon: -80.9956,
    label: 'Port Orange / Daytona Beach, FL',
    tideStation: '8721138',
    tideStationLabel: 'Daytona Beach Shores, FL',
  },
  titusville: {
    key: 'titusville',
    lat: 28.6122,
    lon: -80.8076,
    label: 'Titusville / Space Coast (Indian River Lagoon), FL',
    tideStation: '8721604',
    tideStationLabel: 'Trident Pier, Port Canaveral, FL',
  },
};

const CACHE_TTL_MS = 5 * 60 * 1000;

/** HTTP timeout for NOAA + Open-Meteo (ms); avoids hung sockets */
const FETCH_TIMEOUT_MS = 6500;

const LIVE_DATA_UNAVAILABLE = 'Live data temporarily unavailable';

/**
 * node-fetch with AbortController timeout — network errors and abort become catchable rejects.
 */
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

/** NOAA api.weather.gov requires a descriptive User-Agent */
const NOAA_USER_AGENT = '(Launch Zone Charters, https://launchzonecharters.com)';

const cacheByLocation = new Map();

function resolveLocationConfig(locationKey) {
  const key = typeof locationKey === 'string' ? locationKey.trim().toLowerCase() : 'daytona';
  return LOCATION_CONFIGS[key] || LOCATION_CONFIGS.daytona;
}

function noaaHeaders() {
  return {
    'User-Agent': NOAA_USER_AGENT,
    Accept: 'application/geo+json, application/json',
  };
}

function parseWindMph(windSpeedStr) {
  if (!windSpeedStr || typeof windSpeedStr !== 'string') return null;
  const low = windSpeedStr.toLowerCase();
  if (low.includes('calm')) return 0;
  const nums = windSpeedStr.match(/\d+(?:\.\d+)?/g);
  if (!nums || nums.length === 0) return null;
  const vals = nums.map(Number);
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function degToCompass(deg) {
  if (deg == null || Number.isNaN(deg)) return null;
  const dirs = [
    'N',
    'NNE',
    'NE',
    'ENE',
    'E',
    'ESE',
    'SE',
    'SSE',
    'S',
    'SSW',
    'SW',
    'WSW',
    'W',
    'WNW',
    'NW',
    'NNW',
  ];
  const i = Math.round(Number(deg) / 22.5) % 16;
  return dirs[i];
}

function cToF(c) {
  if (c == null || Number.isNaN(c)) return null;
  return (Number(c) * 9) / 5 + 32;
}

function mToFt(m) {
  if (m == null || Number.isNaN(m)) return null;
  return Number(m) * 3.28084;
}

function closestHourlyIndex(times) {
  if (!Array.isArray(times) || times.length === 0) return 0;
  const now = Date.now();
  let best = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < times.length; i++) {
    const t = new Date(times[i]).getTime();
    if (Number.isNaN(t)) continue;
    const d = Math.abs(t - now);
    if (d < bestDiff) {
      bestDiff = d;
      best = i;
    }
  }
  return best;
}

/**
 * @param {number|null} waveFt
 * @param {number|null} windMph
 */
function computeMarineStatus(waveFt, windMph) {
  const w = windMph != null && !Number.isNaN(windMph) ? windMph : null;
  const wh = waveFt != null && !Number.isNaN(waveFt) ? waveFt : null;

  if (wh != null) {
    if (wh < 2 && w != null && w < 10) {
      return { level: 'excellent', label: '🟢 Excellent Conditions' };
    }
    if (wh < 4) {
      return { level: 'moderate', label: '🟡 Moderate Conditions' };
    }
    return { level: 'rough', label: '🔴 Rough Conditions' };
  }

  if (w != null) {
    if (w < 10) return { level: 'moderate', label: '🟡 Moderate Conditions' };
    if (w < 20) return { level: 'moderate', label: '🟡 Moderate Conditions' };
    return { level: 'rough', label: '🔴 Rough Conditions' };
  }

  return { level: 'unknown', label: 'Conditions unavailable' };
}

async function fetchNoaaPointsAndForecast(location) {
  const pointsUrl = `https://api.weather.gov/points/${location.lat},${location.lon}`;
  const pointsRes = await fetch(pointsUrl, { headers: noaaHeaders() });
  const pointsJson = await pointsRes.json().catch(() => ({}));
  if (!pointsRes.ok) {
    const err = new Error(pointsJson?.detail || `NOAA points HTTP ${pointsRes.status}`);
    err.status = pointsRes.status;
    throw err;
  }

  const forecastHref = pointsJson?.properties?.forecast;
  if (!forecastHref) {
    throw new Error('NOAA points response missing properties.forecast');
  }

  const forecastRes = await fetch(forecastHref, { headers: noaaHeaders() });
  const forecastJson = await forecastRes.json().catch(() => ({}));
  if (!forecastRes.ok) {
    const err = new Error(forecastJson?.detail || `NOAA forecast HTTP ${forecastRes.status}`);
    err.status = forecastRes.status;
    throw err;
  }

  return { pointsJson, forecastJson };
}

async function fetchNoaaAlerts(location) {
  const url = `https://api.weather.gov/alerts/active?status=actual&point=${location.lat},${location.lon}`;
  let res;
  try {
    res = await fetchWithTimeout(url, { headers: noaaHeaders() });
  } catch (e) {
    throw new Error(`NOAA alerts fetch failed: ${e?.message || e}`);
  }
  let json = {};
  try {
    json = await res.json();
  } catch {
    json = {};
  }
  if (!res.ok) {
    const err = new Error(json?.detail || `NOAA alerts HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

async function fetchOpenMeteoMarine(location) {
  const url = `https://marine-api.open-meteo.com/v1/marine?latitude=${location.lat}&longitude=${location.lon}&hourly=wave_height,sea_surface_temperature&length=168`;
  let res;
  try {
    res = await fetchWithTimeout(url);
  } catch (e) {
    throw new Error(`Open-Meteo marine fetch failed: ${e?.message || e}`);
  }
  let json = {};
  try {
    json = await res.json();
  } catch {
    json = {};
  }
  if (!res.ok) {
    throw new Error(`Open-Meteo marine HTTP ${res.status}`);
  }
  return json;
}

async function fetchOpenMeteoWind(location) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${location.lat}&longitude=${location.lon}&hourly=wind_speed_10m,wind_direction_10m&wind_speed_unit=mph&timezone=America%2FNew_York`;
  let res;
  try {
    res = await fetchWithTimeout(url);
  } catch (e) {
    throw new Error(`Open-Meteo wind fetch failed: ${e?.message || e}`);
  }
  let json = {};
  try {
    json = await res.json();
  } catch {
    json = {};
  }
  if (!res.ok) {
    throw new Error(`Open-Meteo forecast HTTP ${res.status}`);
  }
  return json;
}

function normalizeAlerts(alertsJson) {
  const features = Array.isArray(alertsJson?.features) ? alertsJson.features : [];
  return features.map((f) => {
    const p = f?.properties || {};
    return {
      event: p.event || 'Alert',
      headline: p.headline || p.event || '',
      description: (p.description || '').trim(),
      severity: p.severity || '',
      areaDesc: p.areaDesc || '',
      effective: p.effective || null,
      expires: p.expires || null,
    };
  });
}

function formatLocalTimeCompact(value) {
  const dt = new Date(String(value || ''));
  if (!Number.isFinite(dt.getTime())) return null;
  return dt.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

async function fetchNoaaTideSummary(location) {
  if (!location?.tideStation) return null;
  const url =
    `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter` +
    `?product=predictions` +
    `&application=launch_zone_charters` +
    `&date=today` +
    `&datum=MLLW` +
    `&station=${encodeURIComponent(location.tideStation)}` +
    `&time_zone=lst_ldt` +
    `&units=english` +
    `&interval=hilo` +
    `&format=json`;

  let res;
  try {
    res = await fetchWithTimeout(url);
  } catch (e) {
    throw new Error(`NOAA tides fetch failed: ${e?.message || e}`);
  }

  let json = {};
  try {
    json = await res.json();
  } catch {
    json = {};
  }
  if (!res.ok) {
    throw new Error(`NOAA tides HTTP ${res.status}`);
  }

  const predictions = Array.isArray(json?.predictions) ? json.predictions : [];
  if (predictions.length === 0) return null;

  const now = Date.now();
  const next24h = now + 24 * 60 * 60 * 1000;
  const normalized = predictions
    .map((p) => ({
      at: new Date(String(p?.t || '')).getTime(),
      height: Number(p?.v),
      type: String(p?.type || '').toUpperCase(),
    }))
    .filter(
      (p) =>
        Number.isFinite(p.at) &&
        Number.isFinite(p.height) &&
        (p.type === 'H' || p.type === 'L') &&
        p.at >= now &&
        p.at <= next24h
    )
    .sort((a, b) => a.at - b.at);

  const nextHigh = normalized.find((p) => p.type === 'H') || null;
  const nextLow = normalized.find((p) => p.type === 'L') || null;
  if (!nextHigh && !nextLow) return null;

  const highTime = nextHigh ? formatLocalTimeCompact(new Date(nextHigh.at).toISOString()) : null;
  const lowTime = nextLow ? formatLocalTimeCompact(new Date(nextLow.at).toISOString()) : null;
  const summaryParts = [];
  if (highTime) summaryParts.push(`H ${highTime}`);
  if (lowTime) summaryParts.push(`L ${lowTime}`);

  return {
    summary: summaryParts.join(' · '),
    nextHighTide: nextHigh
      ? {
          time: highTime,
          heightFt: nextHigh.height,
        }
      : null,
    nextLowTide: nextLow
      ? {
          time: lowTime,
          heightFt: nextLow.height,
        }
      : null,
    stationId: location.tideStation,
    stationLabel: location.tideStationLabel || null,
  };
}

/**
 * Merge NOAA + Open-Meteo; cache 5 minutes.
 * @returns {Promise<object>}
 */
async function getMarineConditions(options = {}) {
  const location = resolveLocationConfig(options.locationKey);
  const cacheKey = location.key;
  const now = Date.now();
  const cached = cacheByLocation.get(cacheKey);
  if (cached?.payload && cached.expires > now) {
    console.log('[marine-conditions] cache hit (TTL 5m)');
    return { ...cached.payload, cached: true };
  }

  try {
  let pointsJson = null;
  let forecastJson = null;
  let alertsJson = null;
  let marineJson = null;
  let windJson = null;

  let noaaForecastError = null;
  let noaaAlertsError = null;
  let noaaTidesError = null;
  let openMeteoMarineError = null;
  let openMeteoWindError = null;
  let tideSummary = null;
  let nextHighTide = null;
  let nextLowTide = null;
  let tideStationId = location.tideStation || null;
  let tideStationLabel = location.tideStationLabel || null;

  try {
    const noaa = await fetchNoaaPointsAndForecast(location);
    pointsJson = noaa.pointsJson;
    forecastJson = noaa.forecastJson;
    console.log('[marine-conditions] NOAA points + grid forecast OK');
    console.log('[marine-conditions] NOAA forecast response:', JSON.stringify(forecastJson).slice(0, 4000));
  } catch (e) {
    noaaForecastError = e?.message || String(e);
    console.warn('[marine-conditions] NOAA forecast failed:', noaaForecastError);
  }

  try {
    alertsJson = await fetchNoaaAlerts(location);
    console.log('[marine-conditions] NOAA alerts OK');
    console.log('[marine-conditions] NOAA alerts response:', JSON.stringify(alertsJson).slice(0, 3000));
  } catch (e) {
    noaaAlertsError = e?.message || String(e);
    console.warn('[marine-conditions] NOAA alerts failed:', noaaAlertsError);
  }

  try {
    const tideData = await fetchNoaaTideSummary(location);
    if (tideData) {
      tideSummary = tideData.summary;
      nextHighTide = tideData.nextHighTide;
      nextLowTide = tideData.nextLowTide;
      tideStationId = tideData.stationId || tideStationId;
      tideStationLabel = tideData.stationLabel || tideStationLabel;
      console.log('[marine-conditions] NOAA tides OK');
    } else {
      console.log('[marine-conditions] NOAA tides returned no upcoming prediction');
    }
  } catch (e) {
    noaaTidesError = e?.message || String(e);
    console.warn('[marine-conditions] NOAA tides failed:', noaaTidesError);
  }

  try {
    marineJson = await fetchOpenMeteoMarine(location);
    console.log('[marine-conditions] Open-Meteo marine OK');
    console.log('[marine-conditions] Open-Meteo marine response:', JSON.stringify(marineJson).slice(0, 4000));
  } catch (e) {
    openMeteoMarineError = e?.message || String(e);
    console.warn('[marine-conditions] Open-Meteo marine failed:', openMeteoMarineError);
  }

  try {
    windJson = await fetchOpenMeteoWind(location);
    console.log('[marine-conditions] Open-Meteo wind OK');
    console.log('[marine-conditions] Open-Meteo wind response:', JSON.stringify(windJson).slice(0, 4000));
  } catch (e) {
    openMeteoWindError = e?.message || String(e);
    console.warn('[marine-conditions] Open-Meteo wind failed:', openMeteoWindError);
  }

  const periods = Array.isArray(forecastJson?.properties?.periods) ? forecastJson.properties.periods : [];
  const first = periods[0] || null;

  let windSpeed = first ? parseWindMph(first.windSpeed) : null;
  let windDirection = first?.windDirection || null;
  let airTempF = first?.temperature != null && first?.temperatureUnit === 'F' ? Number(first.temperature) : null;
  let shortForecast = first ? `${first.name || ''}: ${first.shortForecast || ''}`.trim() : '';

  const hourlyT = marineJson?.hourly?.time;
  const waveM = hourlyT ? marineJson?.hourly?.wave_height?.[closestHourlyIndex(hourlyT)] : null;
  const sstC = hourlyT ? marineJson?.hourly?.sea_surface_temperature?.[closestHourlyIndex(hourlyT)] : null;

  const wTimes = windJson?.hourly?.time;
  const wi = wTimes ? closestHourlyIndex(wTimes) : 0;
  const omWindMph = wTimes ? windJson?.hourly?.wind_speed_10m?.[wi] : null;
  const omWindDeg = wTimes ? windJson?.hourly?.wind_direction_10m?.[wi] : null;

  if (windSpeed == null && omWindMph != null) {
    windSpeed = Number(omWindMph);
  }
  if (!windDirection && omWindDeg != null) {
    windDirection = degToCompass(omWindDeg);
  }

  const waveHeightFtRaw = mToFt(waveM);
  const waveHeightFt =
    waveHeightFtRaw != null ? Math.round(waveHeightFtRaw * 100) / 100 : null;
  const waterTempF = cToF(sstC);

  const alerts = alertsJson ? normalizeAlerts(alertsJson) : [];

  const forecastSummary =
    first?.detailedForecast ||
    first?.shortForecast ||
    (periods.length ? periods.map((p) => `${p.name}: ${p.shortForecast}`).join(' ') : '');

  const hasAnyData =
    (forecastJson && periods.length > 0) ||
    waveHeightFt != null ||
    waterTempF != null ||
    windSpeed != null;

  if (!hasAnyData) {
    const payload = {
      success: false,
      error: LIVE_DATA_UNAVAILABLE,
      timestamp: new Date().toISOString(),
      source: 'NOAA + Open-Meteo',
      locationLabel: location.label,
      details: {
        noaaForecastError,
        noaaAlertsError,
        noaaTidesError,
        openMeteoMarineError,
        openMeteoWindError,
      },
    };
    console.warn('[marine-conditions] merged (no usable data):', JSON.stringify(payload));
    return { ...payload, cached: false };
  }

  const status = computeMarineStatus(waveHeightFt, windSpeed);

  const forecastTable = periods.slice(0, 10).map((p) => ({
    name: p.name || '',
    shortForecast: p.shortForecast || '',
    temperature: p.temperature != null ? `${p.temperature}°${p.temperatureUnit || 'F'}` : '—',
    windSpeed: p.windSpeed || '—',
    windDirection: p.windDirection || '',
  }));

  const merged = {
    success: true,
    windSpeed,
    windDirection: windDirection || null,
    waveHeightFt,
    waterTempF,
    airTempF,
    shortForecast: shortForecast || null,
    tideSummary,
    nextHighTide,
    nextLowTide,
    forecast: forecastSummary,
    forecastPeriods: forecastTable,
    alerts,
    status: status.label,
    statusLevel: status.level,
    source: 'NOAA + Open-Meteo',
    timestamp: new Date().toISOString(),
    locationLabel: location.label,
    coordinates: { latitude: location.lat, longitude: location.lon },
    tideStationId,
    tideStationLabel,
    gridForecastUrl: pointsJson?.properties?.forecast || null,
    meta: {
      noaaForecastOk: Boolean(forecastJson && periods.length),
      noaaAlertsOk: !noaaAlertsError,
      openMeteoMarineOk: !openMeteoMarineError,
      openMeteoWindOk: !openMeteoWindError,
      warnings: [
        noaaForecastError && `NOAA forecast: ${noaaForecastError}`,
        noaaAlertsError && `NOAA alerts: ${noaaAlertsError}`,
        noaaTidesError && `NOAA tides: ${noaaTidesError}`,
        openMeteoMarineError && `Open-Meteo marine: ${openMeteoMarineError}`,
        openMeteoWindError && `Open-Meteo wind: ${openMeteoWindError}`,
      ].filter(Boolean),
    },
  };

  console.log('[marine-conditions] final merged output:', JSON.stringify(merged));

  cacheByLocation.set(cacheKey, { expires: Date.now() + CACHE_TTL_MS, payload: merged });
  return { ...merged, cached: false };
  } catch (unexpected) {
    console.warn(
      '[marine-conditions] pipeline error:',
      unexpected?.message || unexpected
    );
    return {
      success: false,
      error: LIVE_DATA_UNAVAILABLE,
      timestamp: new Date().toISOString(),
      source: 'NOAA + Open-Meteo',
      locationLabel: location.label,
      cached: false,
    };
  }
}

module.exports = {
  getMarineConditions,
  LOCATION_CONFIGS,
};
