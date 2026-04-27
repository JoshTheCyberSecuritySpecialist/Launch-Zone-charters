/**
 * Bioluminescence scoring: live OpenWeather + moon + optional tide + water temp.
 * Weighted model (season / water / moon / wind / clouds): see bioGlowModel.js.
 * Requires weather + moon; tide is best-effort and does not block scoring.
 */

const { getWeather } = require('./weatherService');
const { getMoonPhase, getMoonInfo, isValidMoonPhase, getNextNewMoonHint } = require('./moonService');
const { getTide, summarizeTideExtremes } = require('./tideService');
const { computeGlowAssessment, estimateLagoonWaterTempF, getCalendarMonthET } = require('./bioGlowModel');
const { getCurrentMarineSstF } = require('./marineWaterTempService');
const { statusToRating, buildConditionsFromEval } = require('./bioPublicPayload');

/** Caps external API wait budget (OpenWeather + tide + marine). Default 30s. */
const BIO_EXTERNAL_API_TIMEOUT_MS = Math.min(
  Math.max(parseInt(process.env.BIO_REQUEST_TIMEOUT_MS || '30000', 10) || 30000, 5000),
  120000
);

const UNAVAILABLE_MSG = 'Live environmental data unavailable';

function unavailable() {
  return {
    success: false,
    status: 'UNAVAILABLE',
    message: UNAVAILABLE_MSG,
  };
}

/**
 * OpenWeather current payload — require wind, clouds, and air temp (imperial °F).
 * @param {object} data
 * @returns {{ wind: number, clouds: number, tempF: number } | null}
 */
function parseOpenWeatherMetrics(data) {
  if (!data || typeof data !== 'object') return null;
  const wind = data.wind?.speed;
  const clouds = data.clouds?.all;
  const tempF = data.main?.temp;
  if (typeof wind !== 'number' || !Number.isFinite(wind) || wind < 0) return null;
  if (typeof clouds !== 'number' || !Number.isFinite(clouds) || clouds < 0 || clouds > 100) return null;
  if (typeof tempF !== 'number' || !Number.isFinite(tempF)) return null;
  return { wind, clouds, tempF };
}

/**
 * Same scoring as alerts / monitors, without Ollama. Strict live data only.
 */
async function evaluateBioConditions() {
  try {
    const moonPhase = getMoonPhase();
    if (!isValidMoonPhase(moonPhase)) {
      console.error('❌ evaluateBioConditions: invalid moon phase');
      return unavailable();
    }

    const moonInfo = getMoonInfo(moonPhase);
    if (
      !moonInfo ||
      typeof moonInfo.label !== 'string' ||
      typeof moonInfo.illuminationPercent !== 'number' ||
      !Number.isFinite(moonInfo.illuminationPercent)
    ) {
      console.error('❌ evaluateBioConditions: invalid moon info');
      return unavailable();
    }

    let rawWeather;
    let tideExtremes;
    let marineSst;
    try {
      [rawWeather, tideExtremes, marineSst] = await Promise.race([
        Promise.all([getWeather(), getTide(), getCurrentMarineSstF()]),
        new Promise((_, reject) => {
          setTimeout(
            () =>
              reject(
                new Error(`Bio external APIs exceeded ${BIO_EXTERNAL_API_TIMEOUT_MS}ms`)
              ),
            BIO_EXTERNAL_API_TIMEOUT_MS
          );
        }),
      ]);
    } catch (err) {
      console.error('evaluateBioConditions external APIs:', err?.message || err);
      return unavailable();
    }

    const metrics = parseOpenWeatherMetrics(rawWeather);
    if (!metrics) {
      console.error('❌ evaluateBioConditions: weather payload missing wind/clouds');
      return unavailable();
    }

    const { wind, clouds, tempF } = metrics;
    const hasTide = Array.isArray(tideExtremes) && tideExtremes.length > 0;
    if (!hasTide) {
      console.warn('[bioluminescenceService] tide unavailable; continuing with non-tide factors');
    }
    const tideSummary = summarizeTideExtremes(tideExtremes);

    const month = getCalendarMonthET(new Date());
    let waterTempF;
    let waterTempSource = 'air_estimate';
    let waterTempEstimate = true;
    if (marineSst != null && typeof marineSst.tempF === 'number' && Number.isFinite(marineSst.tempF)) {
      waterTempF = marineSst.tempF;
      waterTempSource = marineSst.source || 'open-meteo-marine';
      waterTempEstimate = false;
    } else {
      waterTempF = estimateLagoonWaterTempF(tempF, month);
    }

    const assessment = computeGlowAssessment({
      date: new Date(),
      airTempF: tempF,
      wind,
      clouds,
      moonIlluminationPercent: moonInfo.illuminationPercent,
      waterTempF,
      waterTempSource,
      waterTempEstimate,
    });

    const status = assessment.glowStatus;
    const score = assessment.weightedScore;

    const { message, explanation } = buildBioCopy({
      tier: assessment.tier,
      status,
      wind,
      clouds,
      moonInfo,
      tideSummary,
      hasTide,
      waterTempF: assessment.waterTempF,
      inDinoSeason: assessment.inDinoSeason,
      hardFailed: assessment.hardFailed,
    });

    return {
      success: true,
      score,
      status,
      message,
      explanation,
      wind,
      clouds,
      tempF,
      moonPhase,
      moonInfo,
      tideExtremes,
      tideSummary,
      assessment,
    };
  } catch (err) {
    console.error('❌ evaluateBioConditions:', err?.message || err);
    if (err?.stack) console.error(err.stack);
    return unavailable();
  }
}

/**
 * @returns {Promise<
 *   | { status: 'UNAVAILABLE'; message: string }
 *   | {
 *       status: 'OK';
 *       data: object;
 *       analysis: null;
 *     }
 * >}
 */
async function getBioConditions() {
  try {
    const base = await evaluateBioConditions();
    if (!base.success || base.status === 'UNAVAILABLE') {
      return {
        status: 'UNAVAILABLE',
        message: base.message || UNAVAILABLE_MSG,
      };
    }

    const {
      score,
      status,
      message,
      explanation,
      wind,
      clouds,
      tempF,
      moonPhase,
      moonInfo,
      tideExtremes,
      tideSummary,
      assessment,
    } = base;

    const rating = statusToRating(status);
    const conditions = buildConditionsFromEval({
      wind,
      clouds,
      moonInfo,
      tideSummary,
      tempF,
      waterTempF: assessment.waterTempF,
      waterTempSource: assessment.waterTempSource,
      waterTempEstimate: assessment.waterTempEstimate,
    });

    const nextNewMoon = getNextNewMoonHint(55);

    const data = {
      glowStatus: status,
      score,
      message,
      explanation,
      wind,
      clouds,
      airTempF: tempF,
      waterTempF: assessment.waterTempF,
      waterTempEstimate: assessment.waterTempEstimate,
      waterTempSource: assessment.waterTempSource,
      inDinoSeason: assessment.inDinoSeason,
      hardFailed: assessment.hardFailed,
      hardFailReasons: assessment.hardFailReasons,
      moonPhase,
      moonLabel: moonInfo.label,
      moonIlluminationPercent: moonInfo.illuminationPercent,
      tideSummary,
      tideExtremes,
      rating,
      conditions,
      reasoning: assessment.reasoning,
      scoreComponents: assessment.components,
      nextNewMoon,
    };

    console.log('[bioluminescenceService] status=', status, 'score=', score);

    return {
      status: 'OK',
      data,
      analysis: null,
    };
  } catch (err) {
    console.error('❌ Bio logic error:', err?.message || err);
    if (err?.stack) console.error(err.stack);

    return {
      status: 'UNAVAILABLE',
      message: UNAVAILABLE_MSG,
    };
  }
}

function buildBioCopy({
  tier,
  status,
  wind,
  clouds,
  moonInfo,
  tideSummary,
  hasTide,
  waterTempF,
  inDinoSeason,
  hardFailed,
}) {
  const darkMoon = moonInfo.illuminationPercent < 35;
  const calm = wind < 7;
  const clear = clouds < 35;

  let message = 'Glow outlook: LIMITED';
  let explanation =
    'Tonight is a lower-confidence night for lagoon bioluminescence. See the breakdown for why.';

  if (hardFailed) {
    message = 'Glow outlook: LIMITED (hard limits)';
    explanation = [
      !inDinoSeason ? 'Outside May–October: we do not rate above LOW for typical dinoflagellate glow.' : '',
      waterTempF != null && waterTempF < 70
        ? `Water below 70°F (~${waterTempF}°F) forces LOW regardless of moon or wind.`
        : '',
      hasTide ? `Tide: ${tideSummary}` : '',
    ]
      .filter(Boolean)
      .join(' ');
    return { message, explanation };
  }

  if (tier === 'HIGH' || status === 'perfect') {
    message = 'Glow outlook: STRONG';
    explanation = [
      inDinoSeason ? 'Within local glow season (May–October).' : '',
      waterTempF != null ? `Water ~${waterTempF}°F.` : '',
      darkMoon ? 'Dark skies help visibility.' : 'Some moonlight; glow still possible.',
      calm ? `Calm wind (${wind} mph).` : `Moderate wind (${wind} mph).`,
      clear ? 'Mostly clear sky.' : 'Cloudier sky.',
      hasTide ? `Tide: ${tideSummary}` : '',
    ]
      .filter(Boolean)
      .join(' ');
  } else if (tier === 'MEDIUM' || status === 'good') {
    message = 'Glow outlook: MIXED';
    explanation = [
      waterTempF != null ? `Water ~${waterTempF}°F.` : '',
      moonInfo.illuminationPercent > 60 ? 'Brighter moon may wash out the glow.' : 'Moon phase is workable.',
      wind < 12 ? `Wind ${wind} mph.` : `Breezy (${wind} mph); surface may be choppy.`,
      clouds < 55 ? `Clouds ~${Math.round(clouds)}%.` : `Clouds ~${Math.round(clouds)}% (may dull the scene).`,
      hasTide ? `Tide: ${tideSummary}` : '',
    ]
      .filter(Boolean)
      .join(' ');
  } else {
    const parts = [];
    if (!inDinoSeason) parts.push('outside main glow season');
    if (waterTempF != null && waterTempF < 72) parts.push('cool water');
    if (!darkMoon) parts.push('bright moon');
    if (wind >= 12) parts.push('strong wind');
    else if (!calm) parts.push('breezy');
    if (clouds >= 65) parts.push('heavy clouds');
    if (parts.length === 0) parts.push('mixed factors');
    explanation = `Tonight looks tougher for bioluminescence (${parts.join(', ')}). ${hasTide ? `Tide: ${tideSummary}` : ''}`;
  }

  return { message, explanation };
}

module.exports = {
  evaluateBioConditions,
  getBioConditions,
  UNAVAILABLE_MSG,
};
