/**
 * 7-day bioluminescence outlook from OpenWeather 5-day/3-hour forecast + moon per day.
 * Uses the same weighted model as live /api/bioluminescence (bioGlowModel).
 */

const { getForecast5Day } = require('./weatherService');
const { getMoonPhaseForDate, illuminationFromPhase, getMoonInfo } = require('./moonService');
const { computeGlowAssessment, estimateLagoonWaterTempF, getCalendarMonthET } = require('./bioGlowModel');
const { getMarineSstDailyAverageMapET } = require('./marineWaterTempService');

const TZ = 'America/New_York';

/**
 * YYYY-MM-DD in Space Coast timezone, `daysToAdd` from "now" (approximate 24h steps).
 * @param {number} daysToAdd
 */
function getShiftedDateKey(daysToAdd) {
  const now = new Date();
  const shifted = new Date(now.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(shifted);
}

/**
 * @param {Array<{dt?: number, wind?: {speed?: number}, clouds?: {all?: number}, main?: {temp?: number}}>} list
 * @returns {Map<string, { wind: number, clouds: number, tempF: number }>}
 */
function aggregateForecastByDay(list) {
  const sums = new Map();

  for (const item of list) {
    if (!item?.dt) continue;
    const d = new Date(item.dt * 1000);
    const key = new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);

    const w = typeof item.wind?.speed === 'number' ? item.wind.speed : 0;
    const c = typeof item.clouds?.all === 'number' ? item.clouds.all : 0;
    const tf = typeof item.main?.temp === 'number' ? item.main.temp : null;

    if (!sums.has(key)) {
      sums.set(key, { winds: [], clouds: [], temps: [] });
    }
    const bucket = sums.get(key);
    bucket.winds.push(w);
    bucket.clouds.push(c);
    if (tf != null) bucket.temps.push(tf);
  }

  const out = new Map();
  for (const [key, { winds, clouds, temps }] of sums) {
    const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
    const tempF = temps.length ? avg(temps) : NaN;
    out.set(key, {
      wind: avg(winds),
      clouds: avg(clouds),
      tempF,
    });
  }
  return out;
}

/**
 * @returns {Promise<Array<{ date: string, dateLabel: string, status: string, score: number, wind: number, clouds: number, moon: number, estimated?: boolean }> | null>}
 */
async function getWeeklyForecast() {
  try {
    console.log('📅 Generating weekly forecast…');

    const payload = await getForecast5Day();
    const byDay = aggregateForecastByDay(payload.list || []);
    const sstByDay = await getMarineSstDailyAverageMapET();

    let fallbackWind = 8;
    let fallbackClouds = 45;
    let fallbackTemp = 78;
    if (byDay.size > 0) {
      const last = [...byDay.values()].pop();
      fallbackWind = last.wind;
      fallbackClouds = last.clouds;
      if (Number.isFinite(last.tempF)) fallbackTemp = last.tempF;
    }

    const forecast = [];

    for (let i = 0; i < 7; i++) {
      const dateKey = getShiftedDateKey(i);
      const hasWx = byDay.has(dateKey);
      const wx = hasWx
        ? byDay.get(dateKey)
        : { wind: fallbackWind, clouds: fallbackClouds, tempF: fallbackTemp };
      const wind = wx.wind;
      const clouds = wx.clouds;
      const airTempF = Number.isFinite(wx.tempF) ? wx.tempF : fallbackTemp;

      const [y, m, d] = dateKey.split('-').map(Number);
      const moonDate = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
      const moon = getMoonPhaseForDate(moonDate);
      const moonIlluminationPercent = Math.round(illuminationFromPhase(moon) * 100);

      const monthET = getCalendarMonthET(moonDate);
      let waterTempF;
      let waterTempSource = 'air_estimate';
      let waterTempEstimate = true;
      const marineW = sstByDay?.get(dateKey);
      if (marineW != null && Number.isFinite(marineW)) {
        waterTempF = marineW;
        waterTempSource = 'open-meteo-marine';
        waterTempEstimate = false;
      } else {
        waterTempF = estimateLagoonWaterTempF(airTempF, monthET);
      }

      const ass = computeGlowAssessment({
        date: moonDate,
        airTempF,
        wind,
        clouds,
        moonIlluminationPercent,
        waterTempF,
        waterTempSource,
        waterTempEstimate,
      });

      const score = ass.weightedScore;
      const status = ass.glowStatus;
      const moonInfo = getMoonInfo(moon);

      const dateLabel = new Intl.DateTimeFormat('en-US', {
        timeZone: TZ,
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      }).format(new Date(Date.UTC(y, m - 1, d, 12, 0, 0)));

      forecast.push({
        date: dateKey,
        dateLabel,
        /** Same `glowStatus` as GET /api/bioluminescence */
        status,
        /** Same `tier` as live assessment: HIGH | MEDIUM | LOW */
        rating: ass.tier,
        score,
        airTempF: Math.round(airTempF * 10) / 10,
        waterTempF: ass.waterTempF != null ? Math.round(ass.waterTempF * 10) / 10 : null,
        waterTempSource: ass.waterTempSource,
        waterTempEstimate: ass.waterTempEstimate,
        hardFailed: ass.hardFailed,
        wind: Math.round(wind * 10) / 10,
        clouds: Math.round(clouds),
        moon: Math.round(moon * 1000) / 1000,
        moonIlluminationPercent,
        moonLabel: moonInfo.label,
        estimated: !hasWx,
      });
    }

    console.log('[weeklyForecastService] days=', forecast.length, 'keys=', forecast.map((f) => f.date).join(','));
    return forecast;
  } catch (err) {
    console.error('❌ Weekly forecast error:', err?.message || err);
    if (err?.stack) console.error(err.stack);
    return null;
  }
}

module.exports = {
  getWeeklyForecast,
};
