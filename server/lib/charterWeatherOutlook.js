/**
 * Customer-facing charter outlook. Thresholds live here — do not bury numbers in JSX.
 * These labels are informational only. They do not cancel, approve, or operate a charter.
 */

const CHARTER_WEATHER_THRESHOLDS = {
  /** Chance of precipitation in any overlapping hour (%). */
  precipMonitorPct: 30,
  precipConcernPct: 50,
  /** Expected rainfall across the window (inches). */
  rainMonitorIn: 0.1,
  rainConcernIn: 0.25,
  /** Sustained wind (mph). */
  windMonitorMph: 15,
  windConcernMph: 20,
  /** Wind gusts (mph). */
  gustMonitorMph: 18,
  gustConcernMph: 25,
  /** Lowest visibility in the window (miles). */
  visibilityMonitorMi: 3,
  visibilityConcernMi: 1,
};

const OUTLOOK_LABELS = {
  favorable: 'Favorable outlook',
  monitor: 'Conditions may need monitoring',
  concern: 'Weather concern',
  unavailable: 'Forecast not yet available',
};

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function alertIsSevere(alert) {
  const severity = String(alert?.severity || '').toLowerCase();
  const event = String(alert?.event || '').toLowerCase();
  if (severity === 'extreme' || severity === 'severe') return true;
  return /warning|tornado|hurricane|severe thunderstorm|special marine/.test(event);
}

/**
 * @param {{
 *   precipChancePct?: number | null,
 *   precipIn?: number | null,
 *   windMph?: number | null,
 *   gustMph?: number | null,
 *   visibilityMi?: number | null,
 *   alerts?: Array<{ event?: string, severity?: string }>,
 *   hourlyCount?: number,
 * }} input
 */
function buildCharterWeatherOutlook(input = {}) {
  const reasons = [];
  let level = 'favorable';
  const raise = (next) => {
    const rank = { favorable: 0, monitor: 1, concern: 2, unavailable: 3 };
    if (rank[next] > rank[level]) level = next;
  };

  const hourlyCount = Number(input.hourlyCount || 0);
  if (!hourlyCount) {
    return {
      level: 'unavailable',
      label: OUTLOOK_LABELS.unavailable,
      reasons: ['Hourly forecast data is not available for this time yet.'],
    };
  }

  const precip = num(input.precipChancePct);
  if (precip != null && precip >= CHARTER_WEATHER_THRESHOLDS.precipConcernPct) {
    raise('concern');
    reasons.push('Rain is possible during part of this charter.');
  } else if (precip != null && precip >= CHARTER_WEATHER_THRESHOLDS.precipMonitorPct) {
    raise('monitor');
    reasons.push('Rain is possible during part of this charter.');
  }

  const rain = num(input.precipIn);
  if (rain != null && rain >= CHARTER_WEATHER_THRESHOLDS.rainConcernIn) {
    raise('concern');
    if (!reasons.includes('Rain is possible during part of this charter.')) {
      reasons.push('Rain is possible during part of this charter.');
    }
  } else if (rain != null && rain >= CHARTER_WEATHER_THRESHOLDS.rainMonitorIn) {
    raise('monitor');
    if (!reasons.includes('Rain is possible during part of this charter.')) {
      reasons.push('Rain is possible during part of this charter.');
    }
  }

  const gust = num(input.gustMph);
  const wind = num(input.windMph);
  if (
    (gust != null && gust >= CHARTER_WEATHER_THRESHOLDS.gustConcernMph) ||
    (wind != null && wind >= CHARTER_WEATHER_THRESHOLDS.windConcernMph)
  ) {
    raise('concern');
    reasons.push('Strong wind gusts are possible.');
  } else if (
    (gust != null && gust >= CHARTER_WEATHER_THRESHOLDS.gustMonitorMph) ||
    (wind != null && wind >= CHARTER_WEATHER_THRESHOLDS.windMonitorMph)
  ) {
    raise('monitor');
    reasons.push('Strong wind gusts are possible.');
  }

  const visibility = num(input.visibilityMi);
  if (visibility != null && visibility <= CHARTER_WEATHER_THRESHOLDS.visibilityConcernMi) {
    raise('concern');
    reasons.push('Visibility may be reduced.');
  } else if (visibility != null && visibility <= CHARTER_WEATHER_THRESHOLDS.visibilityMonitorMi) {
    raise('monitor');
    reasons.push('Visibility may be reduced.');
  }

  const alerts = Array.isArray(input.alerts) ? input.alerts : [];
  if (alerts.length > 0) {
    if (alerts.some(alertIsSevere)) raise('concern');
    else raise('monitor');
    reasons.push('A National Weather Service advisory is active.');
  }

  return {
    level,
    label: OUTLOOK_LABELS[level],
    reasons: reasons.filter((reason, index) => reasons.indexOf(reason) === index),
  };
}

module.exports = {
  CHARTER_WEATHER_THRESHOLDS,
  OUTLOOK_LABELS,
  buildCharterWeatherOutlook,
};
