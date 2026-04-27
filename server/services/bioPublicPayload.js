/**
 * Helpers for glow API: rating labels + condition lines from validated live metrics only.
 * TODO: Store last successful result in Supabase table `bio_conditions` (id uuid, rating text, conditions jsonb, updated_at timestamptz) for caching.
 */

function statusToRating(status) {
  if (status === 'perfect') return 'HIGH';
  if (status === 'good') return 'MEDIUM';
  if (status === 'poor') return 'LOW';
  return 'Unavailable';
}

/**
 * @param {{ wind: number, clouds: number, moonInfo: { label: string, illuminationPercent: number }, tideSummary: string, tempF?: number, waterTempF?: number|null, waterTempSource?: string, waterTempEstimate?: boolean }} ev
 * @returns {string[]}
 */
function buildConditionsFromEval(ev) {
  const rows = [];
  if (typeof ev.tempF === 'number' && Number.isFinite(ev.tempF)) {
    rows.push(`Air temperature: ${Math.round(ev.tempF * 10) / 10}°F (Titusville area)`);
  }
  if (ev.waterTempF != null && typeof ev.waterTempF === 'number' && Number.isFinite(ev.waterTempF)) {
    const w = Math.round(ev.waterTempF * 10) / 10;
    if (ev.waterTempSource === 'open-meteo-marine') {
      rows.push(`Sea surface temperature: ~${w}°F (Open-Meteo marine, nearshore)`);
    } else {
      rows.push(`Lagoon water (estimated from air): ~${w}°F`);
    }
  }
  if (ev.moonInfo?.label != null && ev.moonInfo?.illuminationPercent != null) {
    rows.push(`Moon: ${ev.moonInfo.label} (~${ev.moonInfo.illuminationPercent}% lit)`);
  }
  if (ev.tideSummary) {
    rows.push(`Tide: ${ev.tideSummary}`);
  }
  if (typeof ev.wind === 'number' && Number.isFinite(ev.wind)) {
    rows.push(`Wind: ${Math.round(ev.wind * 10) / 10} mph`);
  }
  if (typeof ev.clouds === 'number' && Number.isFinite(ev.clouds)) {
    rows.push(`Cloud cover: ${Math.round(ev.clouds)}%`);
  }
  return rows;
}

module.exports = {
  statusToRating,
  buildConditionsFromEval,
};
