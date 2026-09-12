/**
 * Phase C: simultaneous multi-boat captain coverage + ready_for_departure gates.
 * Selling the second boat is gated by CHARTER_MAX_SIMULTANEOUS_BOATS (Phase A).
 * Ready-for-departure always requires distinct captains when two boats overlap.
 */

'use strict';

const {
  bookingRowBlocksSlot,
  intervalsOverlap,
} = require('../lib/sharedCharterCapacity');
const { isTwoBoatCoverageEnabled } = require('../config/charterFleetPriority');

const READY_CAPTAIN_REQUIRED_MESSAGE =
  'Assign a captain before marking this trip ready for departure.';

const READY_DUAL_CAPTAIN_MESSAGE =
  'Two boats are departing at the same time. Assign a different captain to each boat before marking ready for departure.';

const DUAL_BOAT_CAPTAIN_GAP_LABEL =
  'Two boats overlap — need two different captains before ready for departure';

const CENTER_CONSOLE_MISSING_CAPTAIN_LABEL =
  'Center console trip has no captain assigned';

function unwrapBoat(row) {
  const boat = Array.isArray(row?.boats) ? row.boats[0] : row?.boats;
  return boat && typeof boat === 'object' ? boat : null;
}

function isCenterConsoleBoat(row) {
  const boat = unwrapBoat(row);
  const name = String(boat?.name || row?.boat_name || '').toLowerCase();
  const type = String(boat?.type || row?.boat_type || '').toLowerCase();
  return type === 'premium' || /key\s*largo|center\s*console|3827/.test(name);
}

function isActiveCharterRow(row) {
  if (!row || String(row.booking_type || '').trim().toLowerCase() !== 'charter') return false;
  if (!row.boat_id) return false;
  if (['cancelled', 'completed'].includes(String(row.status || ''))) return false;
  return bookingRowBlocksSlot(row);
}

function rowsOverlap(a, b) {
  const aStart = new Date(String(a.start_time || '')).getTime();
  const aEnd = new Date(String(a.end_time || '')).getTime();
  const bStart = new Date(String(b.start_time || '')).getTime();
  const bEnd = new Date(String(b.end_time || '')).getTime();
  if (![aStart, aEnd, bStart, bEnd].every((n) => Number.isFinite(n))) return false;
  return intervalsOverlap(aStart, aEnd, bStart, bEnd);
}

/**
 * Union overlapping charters that span different boats into clusters.
 * @returns {Array<Array<object>>}
 */
function findSimultaneousMultiBoatClusters(rows) {
  const active = (rows || []).filter(isActiveCharterRow);
  const parent = active.map((_, i) => i);

  function find(i) {
    if (parent[i] !== i) parent[i] = find(parent[i]);
    return parent[i];
  }
  function union(i, j) {
    const a = find(i);
    const b = find(j);
    if (a !== b) parent[b] = a;
  }

  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      const a = active[i];
      const b = active[j];
      if (String(a.boat_id) === String(b.boat_id)) continue;
      if (!rowsOverlap(a, b)) continue;
      union(i, j);
    }
  }

  const groups = new Map();
  for (let i = 0; i < active.length; i += 1) {
    const root = find(i);
    const list = groups.get(root) || [];
    list.push(active[i]);
    groups.set(root, list);
  }

  return [...groups.values()].filter((cluster) => {
    const boats = new Set(cluster.map((row) => String(row.boat_id)));
    return boats.size >= 2;
  });
}

function distinctCaptains(cluster) {
  const ids = new Set();
  for (const row of cluster || []) {
    const id = String(row.captain_id || '').trim();
    if (id) ids.add(id);
  }
  return ids;
}

/**
 * Ops-dashboard conflict rows for dual-boat / center-console captain gaps.
 */
function findDualBoatCaptainIssues(rows) {
  const conflicts = [];
  const clusters = findSimultaneousMultiBoatClusters(rows);

  for (const cluster of clusters) {
    const captains = distinctCaptains(cluster);
    const boats = new Set(cluster.map((row) => String(row.boat_id)));
    if (captains.size >= boats.size) continue;

    const missing = cluster.filter((row) => !String(row.captain_id || '').trim());
    const labeledPairs = new Set();
    for (let i = 0; i < cluster.length; i += 1) {
      for (let j = i + 1; j < cluster.length; j += 1) {
        const a = cluster[i];
        const b = cluster[j];
        if (String(a.boat_id) === String(b.boat_id)) continue;
        if (!rowsOverlap(a, b)) continue;
        const key = [a.id, b.id].map(String).sort().join(':');
        if (labeledPairs.has(key)) continue;
        labeledPairs.add(key);
        conflicts.push({
          type: 'dual_boat_captain_gap',
          label: DUAL_BOAT_CAPTAIN_GAP_LABEL,
          booking_id: a.id,
          other_booking_id: b.id,
          boat_id: a.boat_id,
          urgency: 14,
          captains_assigned: captains.size,
          boats_overlapping: boats.size,
        });
      }
    }

    for (const row of missing) {
      conflicts.push({
        type: 'dual_boat_captain_gap',
        label: DUAL_BOAT_CAPTAIN_GAP_LABEL,
        booking_id: row.id,
        other_booking_id: cluster.find((other) => String(other.id) !== String(row.id))?.id || null,
        boat_id: row.boat_id,
        urgency: 14,
        captains_assigned: captains.size,
        boats_overlapping: boats.size,
      });
    }
  }

  for (const row of rows || []) {
    if (!isActiveCharterRow(row)) continue;
    if (String(row.captain_id || '').trim()) continue;
    if (!isCenterConsoleBoat(row)) continue;
    conflicts.push({
      type: 'center_console_missing_captain',
      label: CENTER_CONSOLE_MISSING_CAPTAIN_LABEL,
      booking_id: row.id,
      boat_id: row.boat_id,
      urgency: 12,
    });
  }

  return conflicts;
}

/**
 * Pure check: can this booking become ready_for_departure given peers?
 */
function evaluateReadyForDeparture(booking, peerRows = []) {
  if (!booking) {
    return { ok: false, code: 'not_found', message: 'Booking not found.' };
  }
  if (String(booking.booking_type || '').trim().toLowerCase() !== 'charter') {
    return { ok: true };
  }
  if (!String(booking.captain_id || '').trim()) {
    return {
      ok: false,
      code: 'captain_required',
      message: READY_CAPTAIN_REQUIRED_MESSAGE,
    };
  }

  const combined = [booking, ...(peerRows || []).filter((row) => String(row.id) !== String(booking.id))];
  const clusters = findSimultaneousMultiBoatClusters(combined).filter((cluster) =>
    cluster.some((row) => String(row.id) === String(booking.id))
  );

  for (const cluster of clusters) {
    const boats = new Set(cluster.map((row) => String(row.boat_id)));
    const captains = distinctCaptains(cluster);
    if (captains.size < boats.size) {
      return {
        ok: false,
        code: 'dual_boat_captain_gap',
        message: READY_DUAL_CAPTAIN_MESSAGE,
        boats_overlapping: boats.size,
        captains_assigned: captains.size,
      };
    }
  }

  return { ok: true };
}

async function loadOverlappingCharterPeers(supabase, booking) {
  const start = String(booking.start_time || '');
  const end = String(booking.end_time || '');
  if (!start || !end) return [];

  const { data, error } = await supabase
    .from('bookings')
    .select(
      'id, boat_id, captain_id, start_time, end_time, status, booking_type, charter_type, charter_seating, pricing_package_id, expires_at, hold_expires_at, boats(id, name, type)'
    )
    .eq('booking_type', 'charter')
    .not('boat_id', 'is', null)
    .neq('id', booking.id)
    .in('status', [
      'hold',
      'pending',
      'pending_verification',
      'confirmed',
      'ready_for_departure',
      'completed',
    ])
    .lt('start_time', end)
    .gt('end_time', start);

  if (error) {
    console.warn('[dual-captain] peer load failed:', error.message);
    return [];
  }
  return (data || []).filter((row) => rowsOverlap(booking, row));
}

/**
 * Server gate before setting ready_for_departure.
 */
async function assertReadyForDepartureAllowed(supabase, bookingOrId) {
  let booking = bookingOrId;
  if (typeof bookingOrId === 'string' || typeof bookingOrId === 'number') {
    const { data, error } = await supabase
      .from('bookings')
      .select(
        'id, boat_id, captain_id, start_time, end_time, status, booking_type, charter_type, charter_seating, pricing_package_id, expires_at, hold_expires_at, boats(id, name, type)'
      )
      .eq('id', String(bookingOrId))
      .maybeSingle();
    if (error) throw error;
    booking = data;
  }
  if (!booking?.id) {
    const err = new Error('Booking not found.');
    err.statusCode = 404;
    throw err;
  }

  const peers = await loadOverlappingCharterPeers(supabase, booking);
  const result = evaluateReadyForDeparture(booking, peers);
  if (!result.ok) {
    const err = new Error(result.message);
    err.statusCode = 409;
    err.code = result.code;
    err.conflicts = [
      {
        type: result.code,
        label: result.message,
        booking_id: booking.id,
      },
    ];
    throw err;
  }
  return result;
}

module.exports = {
  CENTER_CONSOLE_MISSING_CAPTAIN_LABEL,
  DUAL_BOAT_CAPTAIN_GAP_LABEL,
  READY_CAPTAIN_REQUIRED_MESSAGE,
  READY_DUAL_CAPTAIN_MESSAGE,
  assertReadyForDepartureAllowed,
  distinctCaptains,
  evaluateReadyForDeparture,
  findDualBoatCaptainIssues,
  findSimultaneousMultiBoatClusters,
  isCenterConsoleBoat,
  isTwoBoatCoverageEnabled,
  loadOverlappingCharterPeers,
  rowsOverlap,
};
