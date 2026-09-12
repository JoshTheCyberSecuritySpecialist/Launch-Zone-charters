/**
 * Atomic charter fleet boat pick via Postgres RPC (advisory lock).
 * Falls back to in-process allocation when the RPC is unavailable.
 */

'use strict';

const charterFleetAllocation = require('./charterFleetAllocation');
const { BIO_DEPARTURE_JUST_FILLED_MESSAGE } = require('./bioSharedFillForward');

function unwrapRpcPayload(data) {
  if (data == null) return null;
  if (typeof data === 'string') {
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (typeof data === 'object') return data;
  return null;
}

function isMissingRpcError(err) {
  const msg = String(err?.message || err?.details || '');
  const code = String(err?.code || '');
  return (
    code === 'PGRST202' ||
    code === '42883' ||
    /could not find the function|lz_pick_charter_fleet_boat|function .* does not exist/i.test(msg)
  );
}

/**
 * @returns {Promise<{
 *   available: boolean,
 *   boatId: string|null,
 *   reason: string|null,
 *   message: string|null,
 *   capacity: object|null,
 *   source: 'rpc'|'fallback',
 *   sticky?: boolean,
 * }>}
 */
async function pickCharterFleetBoatAtomic(supabase, boatCapacityService, input = {}) {
  const {
    startTime,
    endTime,
    passengerCount = 1,
    shared = true,
    excludeBookingId = null,
    preferredBoatId = null,
    stickyBoatAssignment = false,
  } = input;

  const fleet = await charterFleetAllocation.resolveCharterFleetBoats(supabase, boatCapacityService);
  const boatIds = fleet.map((row) => row.boatId).filter(Boolean);
  if (boatIds.length === 0) {
    return {
      available: false,
      boatId: null,
      reason: 'no_boat',
      message: 'Charter boat is not available for this departure. Please call us for help.',
      capacity: null,
      source: 'fallback',
    };
  }

  const preferred = String(preferredBoatId || '').trim() || null;
  const { data, error } = await supabase.rpc('lz_pick_charter_fleet_boat', {
    p_boat_ids: boatIds,
    p_start: startTime,
    p_end: endTime,
    p_guest_count: Math.max(1, Math.floor(Number(passengerCount) || 1)),
    p_exclude_booking_id: excludeBookingId || null,
    p_mode: shared ? 'shared' : 'private',
    p_preferred_boat_id: preferred,
    p_sticky: Boolean(stickyBoatAssignment && preferred),
  });

  if (error) {
    if (!isMissingRpcError(error)) {
      console.warn('[charter-fleet-atomic] rpc error:', error.message || error);
    }
    return {
      available: false,
      boatId: null,
      reason: 'rpc_unavailable',
      message: null,
      capacity: null,
      source: 'fallback',
      rpcError: error,
    };
  }

  const payload = unwrapRpcPayload(data);
  if (!payload || payload.ok !== true || !payload.boat_id) {
    return {
      available: false,
      boatId: null,
      reason: payload?.reason || 'charter_capacity',
      message: payload?.message || BIO_DEPARTURE_JUST_FILLED_MESSAGE,
      capacity: {
        max: 5,
        used: Number(payload?.used) || 0,
        remaining: Number(payload?.remaining) || 0,
        fleetUsed: Number(payload?.fleet_used) || 0,
        requested: Math.max(1, Math.floor(Number(passengerCount) || 1)),
      },
      source: 'rpc',
    };
  }

  const used = Number(payload.used) || 0;
  const remaining = Number.isFinite(Number(payload.remaining))
    ? Number(payload.remaining)
    : Math.max(0, 5 - used);
  return {
    available: true,
    boatId: String(payload.boat_id),
    reason: null,
    message: null,
    capacity: {
      max: 5,
      used,
      remaining,
      fleetUsed: Number(payload.fleet_used) || used,
      requested: Math.max(1, Math.floor(Number(passengerCount) || 1)),
      assignedBoatRole: fleet.find((row) => row.boatId === String(payload.boat_id))?.role || null,
    },
    source: 'rpc',
    sticky: Boolean(payload.sticky),
  };
}

function isCharterHoldContentionError(err) {
  if (!err) return false;
  if (String(err.code || '') === '23P01') return true;
  const msg = String(err.message || '');
  return (
    /exclusion|overlap|bookings_boat_no_time_overlap/i.test(msg) ||
    /shared_charter_capacity_exceeded/i.test(msg) ||
    /shared_charter_exclusive_conflict/i.test(msg)
  );
}

module.exports = {
  BIO_DEPARTURE_JUST_FILLED_MESSAGE,
  isCharterHoldContentionError,
  isMissingRpcError,
  pickCharterFleetBoatAtomic,
  unwrapRpcPayload,
};
