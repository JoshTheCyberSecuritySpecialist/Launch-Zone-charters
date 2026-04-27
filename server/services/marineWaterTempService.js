/**
 * Open-Meteo Marine API — sea surface temperature (no API key).
 * Same coordinates as weatherService (Titusville / Indian River Lagoon).
 * Cached to limit upstream calls (shared across requests).
 */

'use strict';

const fetch = require('node-fetch');
const { DEFAULT_LAT, DEFAULT_LON } = require('./weatherService');

const SOURCE = 'open-meteo-marine';

/** Current SST cache */
const CURRENT_TTL_MS = 45 * 60 * 1000;
let currentCache = { at: 0, payload: null };

/** Hourly forecast SST aggregated by calendar day (ET) */
const FORECAST_TTL_MS = 60 * 60 * 1000;
let forecastCache = { at: 0, map: null };

const TZ = 'America/New_York';

/**
 * @returns {Promise<{ tempF: number, source: string } | null>}
 */
async function getCurrentMarineSstF() {
  const now = Date.now();
  if (currentCache.payload && now - currentCache.at < CURRENT_TTL_MS) {
    return currentCache.payload;
  }

  try {
    const url = `https://marine-api.open-meteo.com/v1/marine?latitude=${DEFAULT_LAT}&longitude=${DEFAULT_LON}&current=sea_surface_temperature&temperature_unit=fahrenheit`;
    const res = await fetch(url);
    if (!res.ok) {
      console.warn('[marineWaterTempService] current HTTP', res.status);
      return null;
    }
    const data = await res.json();
    const sst = data?.current?.sea_surface_temperature;
    if (typeof sst !== 'number' || !Number.isFinite(sst)) {
      return null;
    }
    const out = { tempF: Math.round(sst * 10) / 10, source: SOURCE };
    currentCache = { at: now, payload: out };
    return out;
  } catch (err) {
    console.warn('[marineWaterTempService] current:', err?.message || err);
    return null;
  }
}

/**
 * Map YYYY-MM-DD (America/New_York calendar) → average SST °F for that day from hourly forecast.
 * @returns {Promise<Map<string, number> | null>}
 */
async function getMarineSstDailyAverageMapET() {
  const now = Date.now();
  if (forecastCache.map && now - forecastCache.at < FORECAST_TTL_MS) {
    return forecastCache.map;
  }

  try {
    const url = `https://marine-api.open-meteo.com/v1/marine?latitude=${DEFAULT_LAT}&longitude=${DEFAULT_LON}&hourly=sea_surface_temperature&forecast_days=8&temperature_unit=fahrenheit`;
    const res = await fetch(url);
    if (!res.ok) {
      console.warn('[marineWaterTempService] forecast HTTP', res.status);
      return null;
    }
    const data = await res.json();
    const times = data?.hourly?.time;
    const temps = data?.hourly?.sea_surface_temperature;
    if (!Array.isArray(times) || !Array.isArray(temps) || times.length !== temps.length) {
      return null;
    }

    const sums = new Map();
    const counts = new Map();

    for (let i = 0; i < times.length; i++) {
      const t = temps[i];
      if (typeof t !== 'number' || !Number.isFinite(t)) continue;
      const d = new Date(times[i]);
      const key = new Intl.DateTimeFormat('en-CA', {
        timeZone: TZ,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(d);
      sums.set(key, (sums.get(key) || 0) + t);
      counts.set(key, (counts.get(key) || 0) + 1);
    }

    const map = new Map();
    for (const [key, sum] of sums) {
      const c = counts.get(key) || 1;
      map.set(key, Math.round((sum / c) * 10) / 10);
    }

    forecastCache = { at: now, map };
    return map;
  } catch (err) {
    console.warn('[marineWaterTempService] forecast:', err?.message || err);
    return null;
  }
}

module.exports = {
  getCurrentMarineSstF,
  getMarineSstDailyAverageMapET,
  SOURCE,
};
