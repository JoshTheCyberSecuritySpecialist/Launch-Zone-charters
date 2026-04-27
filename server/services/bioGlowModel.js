/**
 * Space Coast (Titusville / Indian River Lagoon) bioluminescence decision model.
 *
 * HARD FAIL (before scoring): month not May–October OR water &lt; 70°F → forced LOW.
 * Otherwise: weighted score — season 40%, water 25%, moon 20%, wind 10%, clouds 5%.
 * HIGH only possible in-season, not hard-failed, and only from normal scoring path.
 */

'use strict';

const WEIGHTS = {
  season: 0.4,
  water: 0.25,
  moon: 0.2,
  wind: 0.1,
  clouds: 0.05,
};

const T_HIGH = 70;
const T_MED = 48;

const TZ = 'America/New_York';

function getCalendarMonthET(date) {
  const m = new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'numeric' }).format(date);
  return parseInt(m, 10);
}

/** May–October inclusive for dinoflagellate-focused marketing window */
function isPeakSeason(month) {
  return month >= 5 && month <= 10;
}

function estimateLagoonWaterTempF(airTempF, month) {
  const t = Number(airTempF);
  if (!Number.isFinite(t)) return null;
  let lag = 0;
  if (month >= 5 && month <= 10) lag = 1.5;
  else if (month >= 3 && month <= 4) lag = 0.5;
  else lag = -0.5;
  return Math.round((t + lag) * 10) / 10;
}

/**
 * Season score only used when NOT hard-failed (in-season & water ≥ 70°F).
 */
function seasonScoreNormal(month) {
  if (month === 7 || month === 8) return { score: 100, label: 'Peak (Jul–Aug)' };
  if (month >= 5 && month <= 10) return { score: 85, label: 'Glow season (May–Oct)' };
  return { score: 40, label: 'Off-season' };
}

/** Water scoring when water ≥ 70°F: ≥75 strong, 70–74 moderate */
function waterScoreNormal(waterF) {
  if (waterF >= 75) return 100;
  if (waterF >= 70) return 65 + (waterF - 70) * 7;
  return 30;
}

/** Moon: &lt;25% best, &gt;50% poor */
function moonScoreNormal(illuminationPercent) {
  const x = Number(illuminationPercent);
  if (!Number.isFinite(x)) return 50;
  if (x < 25) return 100;
  if (x <= 50) return 68;
  return 32;
}

/** Wind: &lt;8 mph good, &gt;12 mph bad */
function windScoreNormal(windMph) {
  const w = Number(windMph);
  if (!Number.isFinite(w) || w < 0) return 50;
  if (w < 8) return 100;
  if (w <= 12) return 50;
  return 20;
}

function cloudScoreNormal(clouds) {
  const c = Number(clouds);
  if (!Number.isFinite(c)) return 50;
  return Math.max(0, Math.min(100, 100 - c));
}

function monthNameET(date) {
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'long' }).format(date);
}

/**
 * Hard-fail: honest LOW with contextual pros/cons for visibility/wind/moon.
 */
function buildHardFailReasoning(p) {
  const lines = [];
  const { outOfSeason, waterTooCold, waterTempF, waterTempSource, wind, clouds, moonIlluminationPercent, date } = p;

  if (outOfSeason) {
    lines.push({
      kind: 'bad',
      text: `Out of peak season (${monthNameET(date)}). Strong dinoflagellate bioluminescence is unlikely.`,
    });
  }

  if (waterTooCold && waterTempF != null) {
    const src =
      waterTempSource === 'open-meteo-marine'
        ? 'marine data'
        : 'estimated from local conditions';
    lines.push({
      kind: 'bad',
      text: `Water too cold (~${waterTempF}°F, ${src}). Below 70°F we only show LOW.`,
    });
  }

  if (moonIlluminationPercent < 25) {
    lines.push({ kind: 'good', text: 'Low moonlight helps visibility if you still go out.' });
  } else if (moonIlluminationPercent > 50) {
    lines.push({ kind: 'warn', text: 'Higher moonlight makes faint glow harder to see.' });
  } else {
    lines.push({ kind: 'info', text: `Moon ~${moonIlluminationPercent}% lit.` });
  }

  if (wind < 8) {
    lines.push({ kind: 'good', text: `Calm wind (${wind} mph) helps surface visibility.` });
  } else if (wind > 12) {
    lines.push({ kind: 'bad', text: `Wind ${wind} mph can chop the surface and hurt visibility.` });
  } else {
    lines.push({ kind: 'info', text: `Wind ${wind} mph.` });
  }

  if (clouds <= 40) {
    lines.push({ kind: 'good', text: `Mostly clear skies (~${Math.round(clouds)}% clouds).` });
  } else if (clouds >= 70) {
    lines.push({ kind: 'warn', text: `Heavy clouds (~${Math.round(clouds)}%) can dull the scene.` });
  }

  return lines;
}

function buildNormalReasoning(p) {
  const lines = [];
  const { month, waterTempF, waterTempSource, wind, clouds, moonIlluminationPercent, tier } = p;

  if (month === 7 || month === 8) {
    lines.push({ kind: 'good', text: 'Peak months (July–August) on the Space Coast.' });
  } else {
    lines.push({ kind: 'good', text: 'Within May–October glow season.' });
  }

  if (waterTempF != null) {
    const src = waterTempSource === 'open-meteo-marine' ? 'Open-Meteo marine SST' : 'estimated lagoon surface from air temp';
    if (waterTempF >= 75) {
      lines.push({ kind: 'good', text: `Warm water (~${waterTempF}°F, ${src}) supports strong bioluminescence.` });
    } else {
      lines.push({ kind: 'info', text: `Water ~${waterTempF}°F (${src}) — acceptable but not peak warmth.` });
    }
  }

  if (moonIlluminationPercent < 25) {
    lines.push({ kind: 'good', text: 'Dark skies (low moon) help you see the glow.' });
  } else if (moonIlluminationPercent > 50) {
    lines.push({ kind: 'warn', text: 'Bright moonlight reduces how vivid the glow appears.' });
  } else {
    lines.push({ kind: 'info', text: `Moon ~${moonIlluminationPercent}% lit.` });
  }

  if (wind < 8) {
    lines.push({ kind: 'good', text: `Calm wind (${wind} mph).` });
  } else if (wind > 12) {
    lines.push({ kind: 'bad', text: `Wind ${wind} mph is rough for spotting subtle glow.` });
  } else {
    lines.push({ kind: 'info', text: `Moderate wind (${wind} mph).` });
  }

  if (clouds < 35) {
    lines.push({ kind: 'good', text: `Clear skies (~${Math.round(clouds)}% cloud cover).` });
  } else if (clouds > 65) {
    lines.push({ kind: 'warn', text: `Cloud cover ~${Math.round(clouds)}% (minor factor).` });
  }

  return lines;
}

/**
 * @param {object} input
 * @param {Date} [input.date]
 * @param {number} input.airTempF
 * @param {number} input.wind
 * @param {number} input.clouds
 * @param {number} input.moonIlluminationPercent
 * @param {number|null|undefined} [input.waterTempF] resolved °F (marine or estimate)
 * @param {string} [input.waterTempSource]
 */
function computeGlowAssessment(input) {
  const date = input.date instanceof Date ? input.date : new Date();
  const month = getCalendarMonthET(date);
  const inPeakSeason = isPeakSeason(month);

  const wind = Number(input.wind);
  const clouds = Number(input.clouds);
  const moonIlluminationPercent = Number(input.moonIlluminationPercent);

  let waterTempF = input.waterTempF;
  let waterTempSource = input.waterTempSource || 'air_estimate';
  let waterTempEstimate = input.waterTempEstimate !== false;

  if (waterTempF == null || !Number.isFinite(waterTempF)) {
    waterTempF = estimateLagoonWaterTempF(input.airTempF, month);
    waterTempSource = 'air_estimate';
    waterTempEstimate = true;
  }

  const outOfSeason = !inPeakSeason;
  const waterTooCold = waterTempF != null && waterTempF < 70;
  const hardFailed = outOfSeason || waterTooCold;

  if (hardFailed) {
    const reasoning = buildHardFailReasoning({
      outOfSeason,
      waterTooCold,
      waterTempF,
      waterTempSource,
      wind,
      clouds,
      moonIlluminationPercent,
      date,
    });

    return {
      weightedScore: 22,
      tier: 'LOW',
      glowStatus: 'poor',
      hardFailed: true,
      hardFailReasons: [
        ...(outOfSeason ? ['out_of_season'] : []),
        ...(waterTooCold ? ['water_below_70f'] : []),
      ],
      inDinoSeason: inPeakSeason,
      waterTempF,
      waterTempSource,
      waterTempEstimate,
      components: null,
      reasoning,
    };
  }

  const season = seasonScoreNormal(month);
  const wScore = waterScoreNormal(waterTempF);
  const mScore = moonScoreNormal(moonIlluminationPercent);
  const wiScore = windScoreNormal(wind);
  const cScore = cloudScoreNormal(clouds);

  let weighted =
    WEIGHTS.season * season.score +
    WEIGHTS.water * wScore +
    WEIGHTS.moon * mScore +
    WEIGHTS.wind * wiScore +
    WEIGHTS.clouds * cScore;

  let tier = 'LOW';
  if (weighted >= T_HIGH) tier = 'HIGH';
  else if (weighted >= T_MED) tier = 'MEDIUM';

  const glowStatus = tier === 'HIGH' ? 'perfect' : tier === 'MEDIUM' ? 'good' : 'poor';

  const reasoning = buildNormalReasoning({
    month,
    waterTempF,
    waterTempSource,
    wind,
    clouds,
    moonIlluminationPercent,
    tier,
  });

  return {
    weightedScore: Math.round(Math.max(0, Math.min(100, weighted))),
    tier,
    glowStatus,
    hardFailed: false,
    hardFailReasons: [],
    inDinoSeason: inPeakSeason,
    waterTempF,
    waterTempSource,
    waterTempEstimate,
    components: {
      season: { score: season.score, label: season.label, weight: WEIGHTS.season },
      water: { score: wScore, weight: WEIGHTS.water },
      moon: { score: mScore, weight: WEIGHTS.moon },
      wind: { score: wiScore, weight: WEIGHTS.wind },
      clouds: { score: cScore, weight: WEIGHTS.clouds },
    },
    reasoning,
  };
}

module.exports = {
  computeGlowAssessment,
  estimateLagoonWaterTempF,
  getCalendarMonthET,
  isDinoflagellateSeason: isPeakSeason,
  WEIGHTS,
};
