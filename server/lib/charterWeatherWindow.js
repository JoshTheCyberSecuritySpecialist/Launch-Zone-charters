const { DateTime } = require('luxon');
const { BUSINESS_TZ, normalizeClockTime, resolveBookingRangeFromDuration } = require('./bookingDateTimeRange');
const { DEFAULT_CAPTAIN_CHARTER_DURATION_MINUTES } = require('./charterDuration');

const MIN_DURATION_MINUTES = 30;
const MAX_DURATION_MINUTES = 8 * 60;

const WMO_CONDITION_LABELS = {
  0: 'Clear',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Icy fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Heavy drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  80: 'Rain showers',
  81: 'Rain showers',
  82: 'Heavy rain showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm',
  99: 'Thunderstorm',
};

function metersToMiles(meters) {
  const n = Number(meters);
  if (!Number.isFinite(n)) return null;
  return n * 0.000621371;
}

function round(value, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function parseDurationMinutes(value) {
  if (value == null || value === '') return DEFAULT_CAPTAIN_CHARTER_DURATION_MINUTES;
  const n = Number(value);
  if (!Number.isFinite(n) || n < MIN_DURATION_MINUTES || n > MAX_DURATION_MINUTES) {
    return null;
  }
  return Math.round(n);
}

/**
 * Resolve a customer-selected charter window in America/New_York.
 * Overnight bio slots (11:00 PM–12:00 AM) are valid.
 */
function resolveCharterWeatherWindow({ date, startTime, durationMinutes } = {}) {
  const clock = normalizeClockTime(startTime);
  const minutes = parseDurationMinutes(durationMinutes);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || '').trim())) {
    return { ok: false, error: 'A valid date is required (YYYY-MM-DD).' };
  }
  if (!clock) {
    return { ok: false, error: 'A valid start time is required.' };
  }
  if (minutes == null) {
    return { ok: false, error: 'Duration must be between 30 and 480 minutes.' };
  }

  const range = resolveBookingRangeFromDuration({
    date: String(date).trim(),
    startTime: clock,
    durationHours: minutes / 60,
    timeZone: BUSINESS_TZ,
  });
  if (!range.ok) {
    return { ok: false, error: range.error || 'A valid date and start time are required.' };
  }

  const start = range.startDateTime.setZone(BUSINESS_TZ);
  const end = range.endDateTime.setZone(BUSINESS_TZ);
  const startLabel = start.toFormat('h:mm a');
  const endLabel = end.toFormat('h:mm a');
  return {
    ok: true,
    date: start.toFormat('yyyy-MM-dd'),
    startTime: clock,
    durationMinutes: minutes,
    startIso: range.startIso,
    endIso: range.endIso,
    timeZone: BUSINESS_TZ,
    crossesMidnight: range.crossesMidnight,
    label: `Conditions for ${startLabel}–${endLabel}`,
    startMs: start.toUTC().toMillis(),
    endMs: end.toUTC().toMillis(),
    startDateTime: start,
    endDateTime: end,
  };
}

function parseHourlyInstant(iso, zone = BUSINESS_TZ) {
  const raw = String(iso || '');
  if (!raw) return null;
  const dt = raw.includes('T')
    ? DateTime.fromISO(raw, { setZone: true }).setZone(zone)
    : DateTime.fromISO(raw, { zone });
  return dt.isValid ? dt : null;
}

/** Hours whose 60-minute bucket overlaps [start, end). */
function hourlyOverlapsWindow(hourIso, startMs, endMs, zone = BUSINESS_TZ) {
  const hour = parseHourlyInstant(hourIso, zone);
  if (!hour) return false;
  const hourStart = hour.toUTC().toMillis();
  const hourEnd = hour.plus({ hours: 1 }).toUTC().toMillis();
  return hourStart < endMs && hourEnd > startMs;
}

function conditionLabelFromWmo(code) {
  const n = Number(code);
  if (!Number.isFinite(n)) return null;
  if (WMO_CONDITION_LABELS[n]) return WMO_CONDITION_LABELS[n];
  if (n >= 95) return 'Thunderstorm';
  if (n >= 80) return 'Showers';
  if (n >= 60) return 'Rain';
  if (n >= 50) return 'Drizzle';
  if (n >= 40) return 'Fog';
  return 'Cloudy';
}

function pickHourlyValue(series, index) {
  if (!Array.isArray(series) || index < 0) return null;
  const n = Number(series[index]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalize Open-Meteo hourly arrays into trip-window hours.
 * @param {{ time?: string[], [key: string]: unknown }} hourly
 */
function collectWindowHours(hourly, window, extras = {}) {
  const times = Array.isArray(hourly?.time) ? hourly.time : [];
  const rows = [];
  for (let i = 0; i < times.length; i++) {
    if (!hourlyOverlapsWindow(times[i], window.startMs, window.endMs)) continue;
    const dt = parseHourlyInstant(times[i]);
    const visibilityM = pickHourlyValue(hourly.visibility, i);
    rows.push({
      time: times[i],
      timeLabel: dt ? dt.toFormat('h:mm a') : times[i],
      condition: conditionLabelFromWmo(hourly.weather_code?.[i]),
      weatherCode: pickHourlyValue(hourly.weather_code, i),
      temperatureF: round(pickHourlyValue(hourly.temperature_2m, i), 0),
      feelsLikeF: round(pickHourlyValue(hourly.apparent_temperature, i), 0),
      precipChancePct: round(pickHourlyValue(hourly.precipitation_probability, i), 0),
      precipIn: round(pickHourlyValue(hourly.precipitation, i), 2),
      windMph: round(pickHourlyValue(hourly.wind_speed_10m, i), 1),
      gustMph: round(pickHourlyValue(hourly.wind_gusts_10m, i), 1),
      windDirectionDeg: pickHourlyValue(hourly.wind_direction_10m, i),
      windDirection: compassFromDeg(pickHourlyValue(hourly.wind_direction_10m, i)),
      visibilityMi: round(metersToMiles(visibilityM), 1),
      cloudCoverPct: round(pickHourlyValue(hourly.cloud_cover, i), 0),
      humidityPct: round(pickHourlyValue(hourly.relative_humidity_2m, i), 0),
      waveHeightFt: extras.waveByTime?.[times[i]] ?? null,
      waterTempF: extras.waterTempByTime?.[times[i]] ?? null,
    });
  }
  return rows;
}

function maxOf(rows, key) {
  let best = null;
  for (const row of rows) {
    const n = Number(row[key]);
    if (!Number.isFinite(n)) continue;
    if (best == null || n > best) best = n;
  }
  return best;
}

function minOf(rows, key) {
  let best = null;
  for (const row of rows) {
    const n = Number(row[key]);
    if (!Number.isFinite(n)) continue;
    if (best == null || n < best) best = n;
  }
  return best;
}

function sumOf(rows, key) {
  let total = 0;
  let saw = false;
  for (const row of rows) {
    const n = Number(row[key]);
    if (!Number.isFinite(n)) continue;
    total += n;
    saw = true;
  }
  return saw ? total : null;
}

function dominantCondition(rows) {
  const counts = new Map();
  for (const row of rows) {
    if (!row.condition) continue;
    counts.set(row.condition, (counts.get(row.condition) || 0) + 1);
  }
  let best = null;
  let bestCount = 0;
  for (const [label, count] of counts) {
    if (count > bestCount) {
      best = label;
      bestCount = count;
    }
  }
  return best;
}

function compassFromDeg(deg) {
  if (deg == null || Number.isNaN(Number(deg))) return null;
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(Number(deg) / 22.5) % 16];
}

function aggregateWindowHours(rows) {
  if (!rows.length) {
    return {
      condition: null,
      temperatureF: null,
      feelsLikeF: null,
      precipChancePct: null,
      precipIn: null,
      windMph: null,
      gustMph: null,
      windDirection: null,
      visibilityMi: null,
      cloudCoverPct: null,
      humidityPct: null,
      waveHeightFt: null,
      waterTempF: null,
    };
  }
  const mid = rows[Math.floor(rows.length / 2)];
  return {
    condition: dominantCondition(rows) || mid.condition,
    temperatureF: mid.temperatureF,
    feelsLikeF: mid.feelsLikeF,
    precipChancePct: maxOf(rows, 'precipChancePct'),
    precipIn: round(sumOf(rows, 'precipIn'), 2),
    windMph: maxOf(rows, 'windMph'),
    gustMph: maxOf(rows, 'gustMph'),
    windDirection: compassFromDeg(mid.windDirectionDeg),
    visibilityMi: minOf(rows, 'visibilityMi'),
    cloudCoverPct: maxOf(rows, 'cloudCoverPct'),
    humidityPct: mid.humidityPct,
    waveHeightFt: maxOf(rows, 'waveHeightFt'),
    waterTempF: mid.waterTempF,
  };
}

function marineSeriesByTime(marineHourly, field, convert) {
  const times = Array.isArray(marineHourly?.time) ? marineHourly.time : [];
  const series = marineHourly?.[field];
  /** @type {Record<string, number>} */
  const out = {};
  for (let i = 0; i < times.length; i++) {
    const raw = pickHourlyValue(series, i);
    const value = convert ? convert(raw) : raw;
    if (value != null) out[times[i]] = round(value, field === 'sea_surface_temperature' ? 0 : 1);
  }
  return out;
}

module.exports = {
  BUSINESS_TZ,
  aggregateWindowHours,
  collectWindowHours,
  compassFromDeg,
  conditionLabelFromWmo,
  hourlyOverlapsWindow,
  marineSeriesByTime,
  metersToMiles,
  parseDurationMinutes,
  resolveCharterWeatherWindow,
};
