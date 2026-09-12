/**
 * Canonical public captain-led charter boat priority.
 * Identify boats by registration (never hardcode DB UUIDs).
 *
 * Two-boat coverage (default off):
 *   CHARTER_MAX_SIMULTANEOUS_BOATS=2
 *   or CHARTER_TWO_BOAT_COVERAGE=1|true|yes
 */

'use strict';

/** @type {ReadonlyArray<{ priority: number, registration: string, role: string, resolveTripType: string }>} */
const CHARTER_FLEET_PRIORITY = Object.freeze([
  {
    priority: 1,
    registration: 'FL0278PU',
    role: 'pontoon',
    /** Prefer captain_charter resolver (SunCatcher), then pontoon rental identity. */
    resolveTripType: 'captain_charter',
  },
  {
    priority: 2,
    registration: 'FL3827TT',
    role: 'center_console',
    resolveTripType: 'center_console_rental',
  },
]);

function parseTruthyEnv(value) {
  const v = String(value || '')
    .trim()
    .toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/**
 * Max simultaneous captain-led boats sold at one departure.
 * Default 1 until two-captain coverage is explicitly enabled.
 */
function getMaxSimultaneousCharterBoats(env = process.env) {
  const raw = String(env.CHARTER_MAX_SIMULTANEOUS_BOATS || '').trim();
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 1) return Math.min(2, Math.floor(n));
  }
  if (parseTruthyEnv(env.CHARTER_TWO_BOAT_COVERAGE)) return 2;
  return 1;
}

function isTwoBoatCoverageEnabled(env = process.env) {
  return getMaxSimultaneousCharterBoats(env) >= 2;
}

/**
 * Priority entries allowed under the current coverage setting.
 */
function getActiveCharterFleetPriority(env = process.env) {
  const max = getMaxSimultaneousCharterBoats(env);
  return CHARTER_FLEET_PRIORITY.filter((entry) => entry.priority <= max);
}

module.exports = {
  CHARTER_FLEET_PRIORITY,
  getActiveCharterFleetPriority,
  getMaxSimultaneousCharterBoats,
  isTwoBoatCoverageEnabled,
};
