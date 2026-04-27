/**
 * Stormglass tide extremes — Indian River Lagoon reference (Titusville area).
 * Requires STORMGLASS_API_KEY. Returns null on any failure (never throws).
 */

const fetch = require('node-fetch');
const { DEFAULT_LAT, DEFAULT_LON } = require('./weatherService');

async function getTide() {
  const key = (process.env.STORMGLASS_API_KEY || '').trim();
  if (!key) {
    console.warn('[tideService] STORMGLASS_API_KEY not set — tide boost skipped');
    return null;
  }

  try {
    const nowSec = Math.floor(Date.now() / 1000);
    const endSec = nowSec + 48 * 60 * 60;
    const url = `https://api.stormglass.io/v2/tide/extremes/point?lat=${DEFAULT_LAT}&lng=${DEFAULT_LON}&start=${nowSec}&end=${endSec}`;

    console.log('🌊 Fetching tide extremes…');

    const res = await fetch(url, {
      headers: { Authorization: key },
    });

    const data = await res.json();

    if (!res.ok) {
      console.error('❌ Tide HTTP', res.status, data?.errors || data?.message || data);
      return null;
    }

    const list = Array.isArray(data?.data) ? data.data : null;
    if (!list || list.length === 0) {
      console.warn('[tideService] no tide data in window');
      return null;
    }

    console.log('[tideService] extremes count=', list.length);
    return list;
  } catch (err) {
    console.error('❌ Tide error:', err?.message || err);
    if (err?.stack) console.error(err.stack);
    return null;
  }
}

/**
 * Short string for AI + UI (best-effort).
 * @param {Array<{time?: string, height?: number, type?: string}> | null} extremes
 */
function summarizeTideExtremes(extremes) {
  if (!extremes || extremes.length === 0) return 'Tide data unavailable';

  const now = Date.now();
  const upcoming = extremes
    .filter((e) => e?.time && new Date(e.time).getTime() > now)
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

  const next = upcoming[0] || extremes[0];
  const t = next.time ? new Date(next.time) : null;
  const type = (next.type || '').toLowerCase() === 'high' ? 'High' : (next.type || '').toLowerCase() === 'low' ? 'Low' : 'Tide';
  const when = t ? t.toISOString() : 'unknown time';

  return `${type} tide ~ ${when}${typeof next.height === 'number' ? ` (${next.height.toFixed(2)} m)` : ''}`;
}

module.exports = {
  getTide,
  summarizeTideExtremes,
};
