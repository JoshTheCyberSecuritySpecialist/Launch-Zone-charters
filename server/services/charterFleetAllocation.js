/**
 * Party-size-aware fleet allocation for public captain-led charters.
 * Prefers partially filled compatible boats, then highest-priority empty boats.
 * Never splits one party across boats.
 */

'use strict';

const {
  CHARTER_FLEET_PRIORITY,
  getActiveCharterFleetPriority,
  getMaxSimultaneousCharterBoats,
} = require('../config/charterFleetPriority');

/**
 * @param {Array<{
 *   boatId: string,
 *   priority: number,
 *   role?: string,
 *   available: boolean,
 *   used?: number,
 *   remaining?: number,
 *   capacity?: object|null,
 *   reason?: string|null,
 *   message?: string|null,
 *   conflict?: object|null,
 * }>} boatStates
 * @param {{ passengerCount: number, mode?: 'shared'|'private' }} options
 */
function selectFleetBoatForParty(boatStates, options = {}) {
  const passengerCount = Math.max(1, Math.floor(Number(options.passengerCount) || 1));
  const mode = options.mode === 'private' ? 'private' : 'shared';
  const sorted = (boatStates || [])
    .filter((row) => row && row.boatId)
    .slice()
    .sort((a, b) => Number(a.priority) - Number(b.priority) || String(a.boatId).localeCompare(String(b.boatId)));

  if (mode === 'private') {
    const open = sorted.find((row) => {
      if (!row.available) return false;
      const used = Math.max(0, Math.floor(Number(row.used) || 0));
      return used === 0;
    });
    return open || null;
  }

  const fits = sorted.filter((row) => row.available);
  if (fits.length === 0) return null;

  const partial = fits.filter((row) => Math.max(0, Math.floor(Number(row.used) || 0)) > 0);
  if (partial.length > 0) return partial[0];
  return fits[0];
}

function sumFleetUsed(boatStates) {
  return (boatStates || []).reduce((sum, row) => sum + Math.max(0, Math.floor(Number(row.used) || 0)), 0);
}

/**
 * Resolve active fleet boat IDs from registrations / trip-type fallbacks.
 * Dedupes if both priority entries resolve to the same physical boat.
 */
async function resolveCharterFleetBoats(supabase, boatCapacityService, env = process.env) {
  const entries = getActiveCharterFleetPriority(env);
  const out = [];
  const seen = new Set();

  for (const entry of entries) {
    let boatId = null;
    if (typeof boatCapacityService.resolveBoatIdByRegistration === 'function') {
      boatId = await boatCapacityService.resolveBoatIdByRegistration(supabase, entry.registration);
    }
    if (!boatId) {
      boatId = await boatCapacityService.resolveBoatIdForTripType(supabase, entry.resolveTripType);
    }
    if (!boatId) continue;
    const id = String(boatId);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      boatId: id,
      priority: entry.priority,
      role: entry.role,
      registration: entry.registration,
    });
  }

  return out;
}

/**
 * Build capacity payload for the assigned boat, plus fleet occupancy for fill-forward.
 */
function buildAssignedCapacity(selected, boatStates) {
  const capacity = selected?.capacity
    ? { ...selected.capacity }
    : {
        max: null,
        used: Math.max(0, Math.floor(Number(selected?.used) || 0)),
        remaining: Math.max(0, Math.floor(Number(selected?.remaining) || 0)),
        requested: null,
      };
  capacity.fleetUsed = sumFleetUsed(boatStates);
  capacity.assignedBoatRole = selected?.role || null;
  return capacity;
}

module.exports = {
  CHARTER_FLEET_PRIORITY,
  buildAssignedCapacity,
  getMaxSimultaneousCharterBoats,
  resolveCharterFleetBoats,
  selectFleetBoatForParty,
  sumFleetUsed,
};
