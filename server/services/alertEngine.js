const { getWeather } = require('./weatherService');
const { getMarineConditions } = require('./marineConditionsService');
const { getLaunches } = require('./rocketScheduleService');
const { getMoonPhase } = require('./moonService');
const { getTide } = require('./tideService');

const ALERT_THRESHOLD = 5;
let lastSignature = null;
let lastBioSignature = null;
let lastSandbarSignature = null;

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function getTonightLaunchTime(launches) {
  if (!Array.isArray(launches) || launches.length === 0) return null;
  const now = new Date();
  for (const launch of launches) {
    const iso = launch?.net || launch?.window_start;
    if (!iso) continue;
    const dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) continue;
    const isTonight =
      dt.getFullYear() === now.getFullYear() &&
      dt.getMonth() === now.getMonth() &&
      dt.getDate() === now.getDate() &&
      dt.getHours() >= 18;
    if (isTonight) return dt.toISOString();
  }
  return null;
}

function toVisibilityMiles(valueMeters) {
  const meters = toNumber(valueMeters);
  if (meters == null) return null;
  return meters / 1609.344;
}

function isLaunchGood(data) {
  return data.launchTonight === true && data.cloudCover < 50 && data.visibility > 5;
}

function buildSignature(unified) {
  return JSON.stringify({
    wind: unified.wind,
    cloudCover: unified.cloudCover,
    visibility: unified.visibility,
    launchTonight: unified.launchTonight,
  });
}

function buildBioSignature(data) {
  return JSON.stringify({
    date: data.date,
    waterTemp: data.waterTemp,
    wind: data.wind,
    cloudCover: data.cloudCover,
    moonPhase: data.moonPhase,
  });
}

function isBioSeason(date = new Date()) {
  const month = new Date(date).getMonth() + 1;
  return month >= 5 && month <= 10;
}

function isBioluminescenceGood(data) {
  return (
    isBioSeason(data.date) &&
    data.waterTemp >= 75 &&
    data.wind <= 8 &&
    data.cloudCover < 40 &&
    data.moonPhase < 0.4
  );
}

function isGoodTideLevel(tideLevel) {
  return tideLevel >= 1.5 && tideLevel <= 3.5;
}

function isGoodTideTiming(tidePhase) {
  return tidePhase === 'incoming' || tidePhase === 'outgoing';
}

function isSandbarPerfect(data) {
  return (
    isGoodTideLevel(data.tideLevel) &&
    isGoodTideTiming(data.tidePhase) &&
    data.wind <= 10 &&
    data.cloudCover < 50
  );
}

function toFeetFromMeters(valueMeters) {
  const meters = toNumber(valueMeters);
  if (meters == null) return null;
  return meters * 3.28084;
}

function deriveTideState(extremes) {
  if (!Array.isArray(extremes) || extremes.length === 0) {
    return { tideLevel: null, tidePhase: null };
  }

  const now = Date.now();
  const cleaned = extremes
    .map((e) => {
      const when = new Date(e?.time).getTime();
      const type = String(e?.type || '').toLowerCase();
      return {
        when,
        type,
        heightFt: toFeetFromMeters(e?.height),
      };
    })
    .filter((e) => Number.isFinite(e.when) && (e.type === 'high' || e.type === 'low'))
    .sort((a, b) => a.when - b.when);

  if (cleaned.length === 0) {
    return { tideLevel: null, tidePhase: null };
  }

  let prev = null;
  let next = null;
  for (const point of cleaned) {
    if (point.when <= now) prev = point;
    if (point.when > now) {
      next = point;
      break;
    }
  }

  const nearest = next || prev || cleaned[0];
  let tidePhase = null;
  if (prev && next) {
    if (prev.type === 'low' && next.type === 'high') tidePhase = 'incoming';
    if (prev.type === 'high' && next.type === 'low') tidePhase = 'outgoing';
  }

  return {
    tideLevel: nearest?.heightFt ?? null,
    tidePhase,
  };
}

function getBestSandbarWindow(tides) {
  if (!Array.isArray(tides) || tides.length < 2) return null;
  const now = Date.now();
  const nextHigh = tides
    .filter((t) => String(t?.type || '').toLowerCase() === 'high')
    .sort((a, b) => new Date(a?.time).getTime() - new Date(b?.time).getTime())
    .find((t) => {
      const ts = new Date(t?.time).getTime();
      return Number.isFinite(ts) && ts >= now;
    });

  if (!nextHigh) return null;

  const peakTime = new Date(nextHigh.time);
  if (Number.isNaN(peakTime.getTime())) return null;

  const start = new Date(peakTime.getTime() - 60 * 60 * 1000);
  const end = new Date(peakTime.getTime() + 2 * 60 * 60 * 1000);
  return { start, end };
}

function formatTime(date) {
  return date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatTimeRange(start, end) {
  if (!(start instanceof Date) || Number.isNaN(start.getTime())) return null;
  if (!(end instanceof Date) || Number.isNaN(end.getTime())) return null;
  return `${formatTime(start)} - ${formatTime(end)}`;
}

function buildSandbarSignature(data) {
  return JSON.stringify({
    date: data.date,
    wind: data.wind,
    cloudCover: data.cloudCover,
    tideLevel: data.tideLevel,
    tidePhase: data.tidePhase,
  });
}

function scoreConditions(unified) {
  let score = 0;
  if (unified.wind != null) {
    if (unified.wind <= 12) score += 2;
    else if (unified.wind <= 18) score += 1;
  }
  if (unified.cloudCover != null) {
    if (unified.cloudCover <= 40) score += 2;
    else if (unified.cloudCover <= 65) score += 1;
  }
  if (unified.visibility != null) {
    if (unified.visibility >= 10000) score += 1;
  }
  if (unified.launchTonight) {
    score += 2;
  }
  if (unified.launchTime) {
    const hour = new Date(unified.launchTime).getHours();
    if (hour >= 20 || hour <= 6) score += 2;
  }
  return score;
}

async function evaluateAlertConditions() {
  const [weather, marine, launches] = await Promise.all([
    getWeather(),
    getMarineConditions(),
    getLaunches(),
  ]);

  const launchTime = getTonightLaunchTime(launches);
  const unified = {
    wind: toNumber(weather?.wind?.speed) ?? toNumber(marine?.windSpeed),
    cloudCover: toNumber(weather?.clouds?.all),
    visibility: toVisibilityMiles(weather?.visibility),
    launchTonight: Boolean(launchTime),
    launchTime,
  };

  const hasValidCoreData =
    unified.wind != null || unified.cloudCover != null || unified.visibility != null;
  if (!hasValidCoreData) {
    return {
      ok: false,
      reason: 'no-valid-conditions',
      unified,
      score: 0,
      shouldAlert: false,
    };
  }

  const signature = buildSignature(unified);
  if (signature === lastSignature) {
    return {
      ok: true,
      reason: 'no-new-data',
      unified,
      score: 0,
      shouldAlert: false,
    };
  }

  lastSignature = signature;
  const score = scoreConditions(unified);
  const shouldAlert = isLaunchGood(unified) && score >= ALERT_THRESHOLD;

  return {
    ok: true,
    reason: shouldAlert ? 'threshold-met' : 'threshold-not-met',
    unified,
    score,
    threshold: ALERT_THRESHOLD,
    shouldAlert,
  };
}

async function evaluateBioAlertConditions() {
  const [weather, marine] = await Promise.all([getWeather(), getMarineConditions()]);

  const normalized = {
    date: new Date().toISOString(),
    waterTemp:
      toNumber(marine?.waterTempF) ??
      (toNumber(weather?.main?.temp) != null ? toNumber(weather?.main?.temp) - 2 : null),
    wind: toNumber(weather?.wind?.speed) ?? toNumber(marine?.windSpeed),
    cloudCover: toNumber(weather?.clouds?.all),
    moonPhase: toNumber(getMoonPhase()),
  };

  const hasValidCoreData =
    normalized.waterTemp != null &&
    normalized.wind != null &&
    normalized.cloudCover != null &&
    normalized.moonPhase != null;
  if (!hasValidCoreData) {
    return {
      ok: false,
      reason: 'no-valid-conditions',
      unified: normalized,
      shouldAlert: false,
    };
  }

  const signature = buildBioSignature(normalized);
  if (signature === lastBioSignature) {
    return {
      ok: true,
      reason: 'no-new-data',
      unified: normalized,
      shouldAlert: false,
    };
  }

  lastBioSignature = signature;
  const shouldAlert = isBioluminescenceGood(normalized);
  return {
    ok: true,
    reason: shouldAlert ? 'threshold-met' : 'threshold-not-met',
    unified: normalized,
    shouldAlert,
  };
}

async function evaluateSandbarAlertConditions() {
  const [weather, marine, tideExtremes] = await Promise.all([
    getWeather(),
    getMarineConditions(),
    getTide(),
  ]);
  const tide = deriveTideState(tideExtremes);
  const bestWindow = getBestSandbarWindow(tideExtremes);
  const normalized = {
    date: new Date().toISOString(),
    wind: toNumber(weather?.wind?.speed) ?? toNumber(marine?.windSpeed),
    cloudCover: toNumber(weather?.clouds?.all),
    tideLevel: tide.tideLevel,
    tidePhase: tide.tidePhase,
    tides: Array.isArray(tideExtremes) ? tideExtremes : [],
    bestSandbarWindow: bestWindow
      ? {
          start: bestWindow.start.toISOString(),
          end: bestWindow.end.toISOString(),
          text: formatTimeRange(bestWindow.start, bestWindow.end),
        }
      : null,
  };

  const hasValidCoreData =
    normalized.wind != null &&
    normalized.cloudCover != null &&
    normalized.tideLevel != null &&
    normalized.tidePhase != null;
  if (!hasValidCoreData) {
    return {
      ok: false,
      reason: 'no-valid-conditions',
      unified: normalized,
      shouldAlert: false,
    };
  }

  const signature = buildSandbarSignature(normalized);
  if (signature === lastSandbarSignature) {
    return {
      ok: true,
      reason: 'no-new-data',
      unified: normalized,
      shouldAlert: false,
      score: 0,
    };
  }

  lastSandbarSignature = signature;
  const score = isSandbarPerfect(normalized) ? 3 : 0;

  return {
    ok: true,
    reason: score >= 3 ? 'threshold-met' : 'threshold-not-met',
    unified: normalized,
    shouldAlert: score >= 3,
    score,
  };
}

module.exports = {
  evaluateAlertConditions,
  evaluateBioAlertConditions,
  evaluateSandbarAlertConditions,
  scoreConditions,
  isLaunchGood,
  isGoodTideLevel,
  isGoodTideTiming,
  isSandbarPerfect,
  getBestSandbarWindow,
  formatTimeRange,
  isBioSeason,
  isBioluminescenceGood,
  ALERT_THRESHOLD,
};
