/**
 * Simplified lunar cycle position (0 = new moon reference, 0.5 ≈ full moon).
 * Used for bioluminescence scoring — not a substitute for ephemeris data.
 */

const SYNODIC_MONTH = 29.53;
const KNOWN_NEW_MOON = new Date('2024-01-11');

const getMoonPhase = () => {
  const today = new Date();
  const days = (today - KNOWN_NEW_MOON) / (1000 * 60 * 60 * 24);
  const mod = ((days % SYNODIC_MONTH) + SYNODIC_MONTH) % SYNODIC_MONTH;
  const phase = mod / SYNODIC_MONTH;
  return phase;
};

/**
 * Lunar cycle position (0–1) for a specific calendar instant (e.g. local noon for that day).
 * @param {Date} date
 */
function getMoonPhaseForDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  const days = (d.getTime() - KNOWN_NEW_MOON.getTime()) / (1000 * 60 * 60 * 24);
  const mod = ((days % SYNODIC_MONTH) + SYNODIC_MONTH) % SYNODIC_MONTH;
  return mod / SYNODIC_MONTH;
}

/**
 * Approximate illuminated fraction 0–1 (1 = full moon).
 * @param {number} phase - 0..1 from getMoonPhase
 */
function illuminationFromPhase(phase) {
  return (1 - Math.cos(2 * Math.PI * phase)) / 2;
}

/**
 * Human-readable moon line for API + UI.
 * @param {number} phase
 */
function getMoonInfo(phase) {
  const illumination = illuminationFromPhase(phase);
  const pct = Math.round(illumination * 100);

  let label = 'Waxing gibbous';
  if (phase < 0.03 || phase > 0.97) label = 'New moon';
  else if (phase < 0.22) label = 'Waxing crescent';
  else if (phase < 0.28) label = 'First quarter';
  else if (phase < 0.47) label = 'Waxing gibbous';
  else if (phase < 0.53) label = 'Full moon';
  else if (phase < 0.72) label = 'Waning gibbous';
  else if (phase < 0.78) label = 'Last quarter';
  else label = 'Waning crescent';

  return {
    phase,
    illuminationPercent: pct,
    label,
  };
}

/**
 * @param {number} phase
 * @returns {boolean}
 */
function isValidMoonPhase(phase) {
  return typeof phase === 'number' && Number.isFinite(phase) && phase >= 0 && phase <= 1;
}

const TZ = 'America/New_York';

/**
 * Next calendar night with near-new-moon (good for glow visibility), within `maxDays`.
 * @param {number} [maxDays=50]
 * @returns {{ daysFromNow: number, dateLabel: string } | null}
 */
function getNextNewMoonHint(maxDays = 50) {
  for (let i = 0; i <= maxDays; i++) {
    const shifted = new Date(Date.now() + i * 86400000);
    const key = new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(shifted);
    const [y, m, d] = key.split('-').map(Number);
    const moonDate = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    const ph = getMoonPhaseForDate(moonDate);
    if (ph < 0.045 || ph > 0.955) {
      const dateLabel = new Intl.DateTimeFormat('en-US', {
        timeZone: TZ,
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      }).format(new Date(Date.UTC(y, m - 1, d, 12, 0, 0)));
      return { daysFromNow: i, dateLabel };
    }
  }
  return null;
}

module.exports = {
  getMoonPhase,
  getMoonPhaseForDate,
  getMoonInfo,
  illuminationFromPhase,
  isValidMoonPhase,
  getNextNewMoonHint,
};
