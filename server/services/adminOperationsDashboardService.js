const { DateTime } = require('luxon');
const {
  CHARTER_MAX_PASSENGERS,
  evaluateSharedCharterCapacity,
  intervalsOverlap,
  isExclusiveBoatBooking,
  isSharedCharterBooking,
  bookingRowBlocksSlot,
} = require('../lib/sharedCharterCapacity');

const DEFAULT_LAST_REVIEWED = '1970-01-01T00:00:00.000Z';
const NEW_BOOKINGS_LOOKBACK_DAYS = 14;
const NEW_BOOKINGS_LIMIT = 40;
/** Advisory only — does not block bookings. Override via ADMIN_OPS_MIN_TURNAROUND_MINUTES env. */
const ADMIN_OPS_MIN_TURNAROUND_MINUTES = Math.max(
  15,
  Math.min(180, Number(process.env.ADMIN_OPS_MIN_TURNAROUND_MINUTES) || 45)
);

const ALLOWED_SORT = new Set(['trip_date', 'recently_booked', 'customer_name']);
const ALLOWED_FILTER = new Set([
  'today',
  'tomorrow',
  'week',
  'weekend',
  'new',
  'conflict',
  'missing_boat',
  'missing_captain',
  'direct',
  'groupon',
  'staff',
]);

function getBusinessTimezone() {
  return String(process.env.BUSINESS_TIMEZONE || 'America/New_York').trim();
}

function parseOpsSort(raw) {
  const v = String(raw || 'trip_date').trim().toLowerCase();
  return ALLOWED_SORT.has(v) ? v : 'trip_date';
}

/** @returns {{ filter: string | null } | { error: string }} */
function parseOpsFilterQuery(raw) {
  if (raw == null || String(raw).trim() === '') {
    return { filter: null };
  }
  const v = String(raw).trim().toLowerCase();
  if (!ALLOWED_FILTER.has(v)) {
    return { error: `Invalid filter. Allowed: ${[...ALLOWED_FILTER].join(', ')}` };
  }
  return { filter: v };
}

function parseOpsFilter(raw) {
  const parsed = parseOpsFilterQuery(raw);
  return parsed.error ? null : parsed.filter;
}

function validateOpsQuery(sortRaw, filterRaw) {
  const sort = parseOpsSort(sortRaw);
  const sortProvided = sortRaw != null && String(sortRaw).trim() !== '';
  if (sortProvided && !ALLOWED_SORT.has(String(sortRaw).trim().toLowerCase())) {
    return { error: 'Invalid sort parameter.', statusCode: 400 };
  }
  const filterParsed = parseOpsFilterQuery(filterRaw);
  if (filterParsed.error) {
    return { error: filterParsed.error, statusCode: 400 };
  }
  return { sort, filter: filterParsed.filter };
}

function bookingSourceDisplay(row) {
  const src = String(row.booking_source || '').trim().toLowerCase();
  if (src === 'groupon') return 'Groupon';
  if (src === 'admin' || row.staff_created) return 'Staff Entry';
  if (src === 'website' || src === '' || src === 'direct') return 'Direct Website';
  return src.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function tripTypeLabel(row) {
  const bt = String(row.booking_type || '').trim().toLowerCase();
  const ct = String(row.charter_type || '').trim().toLowerCase();
  if (bt === 'charter') {
    if (ct === 'bio') return 'Bioluminescence';
    if (ct === 'rocket') return 'Rocket Launch';
    if (ct === 'sunset' || ct === 'dolphin') return 'Sunset / Wildlife';
    if (ct === 'captain_charter') return 'Captain Charter';
    return ct ? ct.replace(/_/g, ' ') : 'Charter';
  }
  if (bt === 'rental') return 'Boat Rental';
  return bt || 'Booking';
}

function readinessLabel(booking) {
  if (booking.status === 'cancelled') return 'Cancelled';
  if (booking.conflict) return 'Conflict';
  if (!booking.boat_id) return 'Needs Boat';
  if (booking.booking_type === 'charter' && !booking.captain_id) return 'Needs Captain';
  if (booking.outstanding > 0) return 'Needs Payment';
  if (!booking.waiver_done) return 'Needs Waiver';
  if (!booking.insurance_done && booking.booking_type !== 'charter') return 'Needs Insurance';
  if (booking.ready_for_departure) return 'Ready';
  return 'In Progress';
}

async function loadReviewState(supabase, adminUserId) {
  const { data, error } = await supabase
    .from('admin_ops_review_state')
    .select('last_reviewed_at')
    .eq('admin_user_id', adminUserId)
    .maybeSingle();
  if (error && error.code !== 'PGRST116') {
    console.warn('[admin-ops-review] load state:', error.message);
  }
  return data?.last_reviewed_at || DEFAULT_LAST_REVIEWED;
}

async function loadAcknowledgedBookingIds(supabase, adminUserId) {
  const { data, error } = await supabase
    .from('admin_booking_acknowledgements')
    .select('booking_id')
    .eq('admin_user_id', adminUserId);
  if (error) {
    console.warn('[admin-ops-review] ack list:', error.message);
    return new Set();
  }
  return new Set((data || []).map((row) => String(row.booking_id)));
}

function isBookingNewForAdmin(booking, lastReviewedAt, acknowledgedIds) {
  if (acknowledgedIds.has(String(booking.id))) return false;
  const createdMs = new Date(booking.created_at || 0).getTime();
  const reviewedMs = new Date(lastReviewedAt || DEFAULT_LAST_REVIEWED).getTime();
  if (!Number.isFinite(createdMs)) return false;
  return createdMs > reviewedMs;
}

/**
 * @param {Array<object>} rows - raw overlapping candidates on one boat
 */
function detectBoatOverlapConflicts(rows) {
  const conflicts = [];
  const active = (rows || []).filter((row) => bookingRowBlocksSlot(row));
  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      const a = active[i];
      const b = active[j];
      const aStart = new Date(a.start_time).getTime();
      const aEnd = new Date(a.end_time).getTime();
      const bStart = new Date(b.start_time).getTime();
      const bEnd = new Date(b.end_time).getTime();
      if (!intervalsOverlap(aStart, aEnd, bStart, bEnd)) continue;

      const aEx = isExclusiveBoatBooking(a);
      const bEx = isExclusiveBoatBooking(b);
      if (aEx && bEx) {
        conflicts.push({
          type: 'boat_exclusive_overlap',
          label: 'Same boat — two exclusive bookings overlap',
          booking_id: a.id,
          other_booking_id: b.id,
          boat_id: a.boat_id,
          urgency: 15,
        });
      }
    }
  }
  return conflicts;
}

function detectCaptainOverlapConflicts(rows) {
  const conflicts = [];
  const withCaptain = (rows || []).filter(
    (row) => row.captain_id && bookingRowBlocksSlot(row) && !['cancelled', 'completed'].includes(String(row.status))
  );
  for (let i = 0; i < withCaptain.length; i += 1) {
    for (let j = i + 1; j < withCaptain.length; j += 1) {
      const a = withCaptain[i];
      const b = withCaptain[j];
      if (String(a.captain_id) !== String(b.captain_id)) continue;
      const aStart = new Date(a.start_time).getTime();
      const aEnd = new Date(a.end_time).getTime();
      const bStart = new Date(b.start_time).getTime();
      const bEnd = new Date(b.end_time).getTime();
      if (!intervalsOverlap(aStart, aEnd, bStart, bEnd)) continue;
      conflicts.push({
        type: 'captain_overlap',
        label: 'Same captain assigned to overlapping trips',
        booking_id: a.id,
        other_booking_id: b.id,
        captain_id: a.captain_id,
        urgency: 13,
      });
    }
  }
  return conflicts;
}

function detectAssignmentWarnings(bookings, zone) {
  const tz = zone || getBusinessTimezone();
  const warnings = [];
  for (const b of bookings || []) {
    if (['cancelled', 'completed'].includes(String(b.status))) continue;
    if (!b.boat_id) {
      warnings.push({
        type: 'missing_boat',
        label: 'Missing boat assignment',
        booking_id: b.id,
        urgency: 6,
      });
    }
    if (String(b.booking_type) === 'charter' && !b.captain_id) {
      warnings.push({
        type: 'missing_captain',
        label: 'Missing captain assignment',
        booking_id: b.id,
        urgency: 5,
      });
    }
    const sched = parseScheduleStartEnd(b, tz);
    if (!sched.valid || sched.invalidRange) {
      warnings.push({
        type: 'invalid_times',
        label: 'End time is not after start time',
        booking_id: b.id,
        urgency: 7,
      });
    }
  }
  return warnings;
}

function canonicalServiceKey(row) {
  const bt = String(row.booking_type || '').trim().toLowerCase();
  const ct = String(row.charter_type || '').trim().toLowerCase();
  const seating = String(row.charter_seating || '').trim().toLowerCase();
  return `${bt}|${ct}|${seating}`;
}

function normalizedDepartureLocation(row) {
  return String(row.rental_location || '').trim().toLowerCase() || 'unknown';
}

/**
 * Shared departures: no stable shared_departure_id / trip_instance_id exists on bookings (schema audit).
 * When a future column is added, it takes precedence. Otherwise group by boat + normalized start +
 * canonical service + departure location + business timezone — not by overlapping intervals alone.
 */
function sharedDepartureGroupKey(row, zone) {
  const stable =
    row.shared_departure_id ||
    row.departure_id ||
    row.trip_instance_id ||
    row.group_booking_id ||
    row.schedule_slot_id;
  if (stable) return `stable:${String(stable).trim()}`;

  if (!isSharedCharterBooking(row) || !row.boat_id) return null;
  const sched = parseScheduleStartEnd(row, zone);
  if (!sched.valid) return null;
  const startKey = sched.start.setZone(zone).toFormat("yyyy-MM-dd'T'HH:mm");
  return [
    'fallback',
    String(row.boat_id),
    startKey,
    canonicalServiceKey(row),
    normalizedDepartureLocation(row),
    zone,
  ].join('|');
}

function rowsInSharedDepartureGroup(row, allRaw, zone) {
  const key = sharedDepartureGroupKey(row, zone);
  if (!key) return [row];
  return (allRaw || []).filter((other) => {
    if (!isSharedCharterBooking(other)) return false;
    if (String(other.boat_id) !== String(row.boat_id)) return false;
    if (['cancelled', 'completed'].includes(String(other.status))) return false;
    return sharedDepartureGroupKey(other, zone) === key;
  });
}

function detectSharedDepartureCapacityConflicts(rows, zone) {
  const conflicts = [];
  const byKey = new Map();
  for (const row of rows || []) {
    if (!isSharedCharterBooking(row) || !row.boat_id) continue;
    if (['cancelled', 'completed'].includes(String(row.status))) continue;
    const key = sharedDepartureGroupKey(row, zone);
    if (!key) continue;
    const list = byKey.get(key) || [];
    list.push(row);
    byKey.set(key, list);
  }
  for (const list of byKey.values()) {
    if (list.length < 2) continue;
    let used = 0;
    for (const row of list) {
      const gc = Number(row.guest_count || row.passenger_count || 1);
      used += Number.isFinite(gc) ? gc : CHARTER_MAX_PASSENGERS;
    }
    if (used > CHARTER_MAX_PASSENGERS) {
      conflicts.push({
        type: 'shared_capacity_exceeded',
        label: `Shared charter seats may exceed ${CHARTER_MAX_PASSENGERS} for this departure`,
        booking_id: list[0].id,
        other_booking_id: list[1].id,
        boat_id: list[0].boat_id,
        urgency: 14,
      });
    }
  }
  return conflicts;
}

/** Advisory duplicate hints only — does not cancel or merge bookings. */
function detectDuplicateBookingWarnings(rows, zone) {
  const warnings = [];
  const byVoucher = new Map();
  const byStripe = new Map();
  const byExternal = new Map();
  const byCustomerSlot = new Map();
  const tz = zone || getBusinessTimezone();

  const addToMap = (map, key, row) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  };

  for (const row of rows || []) {
    if (['cancelled', 'completed'].includes(String(row.status))) continue;
    addToMap(byVoucher, row.groupon_voucher_id ? String(row.groupon_voucher_id) : null, row);
    addToMap(
      byStripe,
      row.stripe_checkout_session_id ? String(row.stripe_checkout_session_id).trim() : null,
      row
    );
    addToMap(byExternal, row.external_reference ? String(row.external_reference).trim() : null, row);

    const sched = parseScheduleStartEnd(row, tz);
    if (sched.valid && row.customer_id) {
      const slotKey = `${row.customer_id}|${sched.start.setZone(tz).toFormat("yyyy-MM-dd'T'HH:mm")}|${canonicalServiceKey(row)}`;
      addToMap(byCustomerSlot, slotKey, row);
    }
  }

  const pushPairs = (type, label, list) => {
    if (!list || list.length < 2) return;
    for (let i = 1; i < list.length; i += 1) {
      warnings.push({
        type,
        label,
        booking_id: list[0].id,
        other_booking_id: list[i].id,
        urgency: 8,
      });
    }
  };

  for (const list of byVoucher.values()) {
    pushPairs('duplicate_groupon_voucher', 'Possible duplicate Groupon voucher link', list);
  }
  for (const list of byStripe.values()) {
    pushPairs('duplicate_stripe_session', 'Possible duplicate Stripe checkout session', list);
  }
  for (const list of byExternal.values()) {
    pushPairs('duplicate_external_reference', 'Possible duplicate import / external reference', list);
  }
  for (const list of byCustomerSlot.values()) {
    pushPairs(
      'duplicate_customer_slot',
      'Possible duplicate booking for same customer, time, and service',
      list
    );
  }

  return warnings;
}

/**
 * @param {Array} normalizedBookings - ops-shaped rows with boat_id, times, etc.
 * @param {Array} rawRows - DB rows for capacity helpers
 */
function buildScheduleConflicts(normalizedBookings, rawRows, zone) {
  const tz = zone || getBusinessTimezone();
  const byBoat = new Map();
  for (const raw of rawRows || []) {
    if (!raw.boat_id) continue;
    const list = byBoat.get(raw.boat_id) || [];
    list.push(raw);
    byBoat.set(raw.boat_id, list);
  }
  const conflicts = [];
  for (const boatRows of byBoat.values()) {
    conflicts.push(...detectBoatOverlapConflicts(boatRows));
  }
  conflicts.push(...detectSharedDepartureCapacityConflicts(rawRows || [], tz));
  conflicts.push(...detectCaptainOverlapConflicts(rawRows || []));
  conflicts.push(...detectAssignmentWarnings(normalizedBookings, tz));
  conflicts.push(...detectDuplicateBookingWarnings(rawRows || [], tz));

  const seen = new Set();
  return conflicts
    .filter((c) => {
      const key = `${c.type}:${c.booking_id}:${c.other_booking_id || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.urgency - a.urgency)
    .slice(0, 30);
}

function computeUpcomingCounts(rows, zone) {
  const now = DateTime.now().setZone(zone);
  const todayStart = now.startOf('day');
  const tomorrowStart = todayStart.plus({ days: 1 });
  const tomorrowEnd = tomorrowStart.plus({ days: 1 });
  const dayAfterTomorrow = todayStart.plus({ days: 2 });
  const weekEnd = todayStart.plus({ days: 7 });
  const fri = todayStart.set({ weekday: 5 });
  const sunEnd = fri.plus({ days: 2 }).endOf('day');

  let today = 0;
  let tomorrow = 0;
  let weekend = 0;
  let nextSevenDays = 0;

  for (const row of rows || []) {
    if (['cancelled', 'completed'].includes(String(row.status))) continue;
    const start = DateTime.fromISO(String(row.start_time), { zone: 'utc' }).setZone(zone);
    if (!start.isValid) continue;
    if (start >= todayStart && start < todayStart.plus({ days: 1 })) today += 1;
    if (start >= tomorrowStart && start < tomorrowEnd) tomorrow += 1;
    if (start >= todayStart && start < weekEnd) nextSevenDays += 1;
    if (start >= fri.startOf('day') && start <= sunEnd) weekend += 1;
  }

  return { today, tomorrow, weekend, nextSevenDays };
}

async function markBookingReviewed(supabase, adminUserId, bookingId) {
  const { error } = await supabase.from('admin_booking_acknowledgements').upsert(
    {
      admin_user_id: adminUserId,
      booking_id: bookingId,
      acknowledged_at: new Date().toISOString(),
    },
    { onConflict: 'admin_user_id,booking_id' }
  );
  return { error };
}

async function markAllBookingsReviewed(supabase, adminUserId) {
  const now = new Date().toISOString();
  const { error } = await supabase.from('admin_ops_review_state').upsert(
    {
      admin_user_id: adminUserId,
      last_reviewed_at: now,
      updated_at: now,
    },
    { onConflict: 'admin_user_id' }
  );
  return { error, lastReviewedAt: now };
}

function shortDisplayName(fullName) {
  const parts = String(fullName || 'Guest').trim().split(/\s+/);
  if (parts.length === 0) return 'Guest';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
}

function parseScheduleStartEnd(row, zone) {
  const startIso = String(row.start_time || '').trim();
  const endIso = String(row.end_time || '').trim();
  const start = DateTime.fromISO(startIso, { zone: 'utc' }).setZone(zone);
  let end = DateTime.fromISO(endIso, { zone: 'utc' }).setZone(zone);
  if (!start.isValid) {
    return { valid: false, start: null, end: null, overnight: false };
  }
  if (!end.isValid) {
    return { valid: false, start, end: null, overnight: false };
  }
  let overnight = false;
  let invalidRange = false;
  if (end <= start) {
    const charterBio =
      String(row.booking_type) === 'charter' && String(row.charter_type || '').toLowerCase() === 'bio';
    if (charterBio) {
      end = end.plus({ days: 1 });
      overnight = true;
    } else {
      invalidRange = true;
    }
  } else if (end.startOf('day') > start.startOf('day')) {
    overnight = true;
  }
  if (invalidRange) {
    return { valid: false, start, end, overnight: false, invalidRange: true };
  }
  return { valid: true, start, end, overnight, invalidRange: false };
}

function relativeTripLabel(startDt, zone, status) {
  if (!startDt || !startDt.isValid) return { label: null, invalid: true };
  const now = DateTime.now().setZone(zone);
  const today = now.startOf('day');
  const tripDay = startDt.startOf('day');
  const diffDays = Math.floor(tripDay.diff(today, 'days').days);

  if (!['cancelled', 'completed'].includes(String(status)) && startDt < now.minus({ minutes: 30 })) {
    return { label: 'PAST DUE', invalid: false };
  }
  if (diffDays === 0) return { label: 'TODAY', invalid: false };
  if (diffDays === 1) return { label: 'TOMORROW', invalid: false };
  const dow = tripDay.weekday;
  const isWeekendDay = dow === 5 || dow === 6 || dow === 7;
  if (isWeekendDay && diffDays >= 0 && diffDays <= 6) {
    return { label: 'THIS WEEKEND', invalid: false };
  }
  if (diffDays >= 2 && diffDays <= 6) {
    return { label: `IN ${diffDays} DAYS`, invalid: false };
  }
  if (diffDays >= 7 && diffDays <= 13) {
    return { label: 'NEXT WEEK', invalid: false };
  }
  return { label: null, invalid: false };
}

function formatTripDateLong(startDt, compact) {
  if (!startDt?.isValid) return 'Needs scheduling review';
  if (compact) return startDt.toFormat('ccc, MMM d, yyyy').toUpperCase();
  return startDt.toFormat('cccc, MMMM d, yyyy').toUpperCase();
}

function formatScheduledTimeRange(startDt, endDt, overnight) {
  if (!startDt?.isValid || !endDt?.isValid) return 'Time not set';
  const tOpts = { hour: 'numeric', minute: '2-digit' };
  const startStr = startDt.toLocaleString(DateTime.TIME_SIMPLE, tOpts);
  if (!overnight && startDt.hasSame(endDt, 'day')) {
    return `${startStr} – ${endDt.toLocaleString(DateTime.TIME_SIMPLE, tOpts)}`;
  }
  const endDay = endDt.toFormat('cccc, MMMM d').toUpperCase();
  return `${startStr} – ${endDay} AT ${endDt.toLocaleString(DateTime.TIME_SIMPLE, tOpts)}`;
}

function classifyCharterMode(row) {
  const bt = String(row.booking_type || '').trim().toLowerCase();
  if (bt === 'rental') return { mode: 'RENTAL', reliable: true };
  if (bt !== 'charter') return { mode: 'NEEDS REVIEW', reliable: false };
  if (isSharedCharterBooking(row)) return { mode: 'SHARED TRIP', reliable: true };
  if (isExclusiveBoatBooking(row) && !isSharedCharterBooking(row)) {
    return { mode: 'PRIVATE CHARTER', reliable: true };
  }
  const seating = String(row.charter_seating || '').trim().toLowerCase();
  if (seating === 'private') return { mode: 'PRIVATE CHARTER', reliable: true };
  if (seating === 'shared') return { mode: 'SHARED TRIP', reliable: true };
  return { mode: 'NEEDS REVIEW', reliable: false };
}

function serviceNameDetailed(row) {
  const bt = String(row.booking_type || '').trim().toLowerCase();
  const ct = String(row.charter_type || '').trim().toLowerCase();
  const { mode } = classifyCharterMode(row);
  if (bt === 'rental') return 'Boat Rental';
  if (ct === 'bio') {
    if (mode === 'SHARED TRIP') return 'Shared Bioluminescence Tour';
    if (mode === 'PRIVATE CHARTER') return 'Private Bioluminescence Charter';
    return 'Captain-Led Bioluminescence Tour';
  }
  if (ct === 'rocket') return 'Rocket Launch Charter';
  if (ct === 'sunset' || ct === 'dolphin') return 'Dolphin & Sunset Cruise';
  if (ct === 'captain_charter') return 'Captain-Led Charter';
  return tripTypeLabel(row);
}

function captainRequiredForRow(row) {
  return String(row.booking_type || '').trim().toLowerCase() === 'charter';
}

function buildReadinessStatus(norm, row) {
  const pay = String(norm.payment_status || '').toLowerCase();
  const payment =
    pay === 'paid' || pay === 'complete' || pay === 'completed'
      ? 'Paid'
      : norm.outstanding > 0
        ? 'Pending'
        : 'Pending';

  const waiver = norm.waiver_done ? 'Approved' : 'Missing';
  let insurance = 'Not required';
  if (String(row.booking_type) !== 'charter') {
    const ins = String(row.insurance_status || '').toLowerCase();
    if (ins === 'verified') insurance = 'Approved';
    else if (ins === 'submitted') insurance = 'Pending';
    else if (ins === 'rejected') insurance = 'Rejected';
    else insurance = 'Missing';
  }

  let captain = 'Not required';
  if (captainRequiredForRow(row)) {
    captain = row.captain_id ? 'Assigned' : 'Missing';
  }

  const boat = row.boat_id ? 'Assigned' : 'Missing';

  const pending = [payment, waiver, insurance, captain, boat].some((s) =>
    ['Pending', 'Missing', 'Rejected'].includes(s)
  );
  return {
    overall: pending ? 'pending' : 'ready',
    payment,
    waiver,
    insurance,
    captain,
    boat,
  };
}

function indexConflictsByBooking(scheduleConflicts, rawById) {
  const map = new Map();
  const add = (bookingId, detail) => {
    const id = String(bookingId);
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(detail);
  };
  for (const c of scheduleConflicts || []) {
    const other = c.other_booking_id ? rawById.get(String(c.other_booking_id)) : null;
    const cust = other
      ? Array.isArray(other.customers)
        ? other.customers[0]
        : other.customers
      : null;
    const detail = {
      type: c.type,
      message: c.label,
      overlappingBookingId: c.other_booking_id || null,
      overlappingCustomerDisplayName: cust?.full_name ? shortDisplayName(cust.full_name) : null,
      overlappingStart: other?.start_time || null,
      overlappingEnd: other?.end_time || null,
    };
    add(c.booking_id, detail);
    if (c.other_booking_id) add(c.other_booking_id, { ...detail, overlappingBookingId: c.booking_id });
  }
  return map;
}

const CONFLICT_PRIORITY = {
  invalid_times: 1,
  shared_capacity_exceeded: 2,
  boat_exclusive_overlap: 3,
  captain_overlap: 4,
  missing_captain: 5,
  missing_boat: 6,
  duplicate_groupon_voucher: 7,
  duplicate_stripe_session: 7,
  duplicate_external_reference: 7,
  duplicate_customer_slot: 7,
};

function primaryConflictStatus(details) {
  if (!details?.length) return { status: 'No conflict', issues: [] };
  const sorted = [...details].sort(
    (a, b) => (CONFLICT_PRIORITY[a.type] || 99) - (CONFLICT_PRIORITY[b.type] || 99)
  );
  const primary = sorted[0];
  const statusMap = {
    invalid_times: 'Invalid time',
    shared_capacity_exceeded: 'Capacity exceeded',
    boat_exclusive_overlap: 'Possible boat conflict',
    captain_overlap: 'Possible captain conflict',
    missing_boat: 'Missing boat',
    missing_captain: 'Missing captain',
    duplicate_groupon_voucher: 'Possible duplicate',
    duplicate_stripe_session: 'Possible duplicate',
    duplicate_external_reference: 'Possible duplicate',
    duplicate_customer_slot: 'Possible duplicate',
  };
  return {
    status: statusMap[primary.type] || 'Needs review',
    issues: sorted.map((d) => d.type),
  };
}

function sharedClusterGuestTotal(row, allRaw, zone) {
  if (!isSharedCharterBooking(row) || !row.boat_id) return null;
  const cluster = rowsInSharedDepartureGroup(row, allRaw, zone);
  let total = 0;
  for (const other of cluster) {
    const gc = Number(other.guest_count || other.passenger_count || 1);
    total += Number.isFinite(gc) ? gc : CHARTER_MAX_PASSENGERS;
  }
  return total;
}

function capacityLines(row, allRaw, zone) {
  const guests = Number(row.guest_count || row.passenger_count || 1);
  const { mode } = classifyCharterMode(row);
  if (mode === 'SHARED TRIP') {
    const grouped = sharedClusterGuestTotal(row, allRaw, zone) ?? guests;
    return {
      guestsOnReservation: guests,
      capacityText: `Trip capacity: ${grouped} of ${CHARTER_MAX_PASSENGERS} seats booked`,
    };
  }
  if (mode === 'RENTAL') {
    return {
      guestsOnReservation: guests,
      capacityText: `Guests: ${guests} · Boat maximum: ${CHARTER_MAX_PASSENGERS} guests`,
    };
  }
  return {
    guestsOnReservation: guests,
    capacityText: `Guests: ${guests} · Boat maximum: ${CHARTER_MAX_PASSENGERS} guests`,
  };
}

function sameDayTripCount(row, allRaw, zone) {
  const sched = parseScheduleStartEnd(row, zone);
  if (!sched.valid || !row.boat_id) return 0;
  const dayKey = sched.start.toISODate();
  let n = 0;
  for (const other of allRaw) {
    if (String(other.boat_id) !== String(row.boat_id)) continue;
    if (['cancelled', 'completed'].includes(String(other.status))) continue;
    const o = parseScheduleStartEnd(other, zone);
    if (!o.valid) continue;
    if (o.start.toISODate() === dayKey) n += 1;
  }
  return Math.max(0, n - 1);
}

function turnaroundWarningFor(row, allRaw, zone) {
  const sched = parseScheduleStartEnd(row, zone);
  if (!sched.valid) return null;
  let minGap = null;
  for (const other of allRaw) {
    if (String(other.id) === String(row.id)) continue;
    if (['cancelled', 'completed'].includes(String(other.status))) continue;
    const sameBoat = row.boat_id && String(other.boat_id) === String(row.boat_id);
    const sameCaptain =
      row.captain_id && other.captain_id && String(row.captain_id) === String(other.captain_id);
    if (!sameBoat && !sameCaptain) continue;
    const o = parseScheduleStartEnd(other, zone);
    if (!o.valid) continue;
    if (!sched.start.hasSame(o.start, 'day')) continue;
    const gapAfter = o.start.diff(sched.end, 'minutes').minutes;
    const gapBefore = sched.start.diff(o.end, 'minutes').minutes;
    for (const g of [gapAfter, gapBefore]) {
      if (g >= 0 && g < ADMIN_OPS_MIN_TURNAROUND_MINUTES) {
        if (minGap == null || g < minGap) minGap = g;
      }
    }
  }
  if (minGap == null) return null;
  return {
    turnaroundMinutes: Math.round(minGap),
    message: `Turnaround warning — only ${Math.round(minGap)} minutes between trips`,
  };
}

function buildNewBookingCard(raw, norm, ctx) {
  const zone = ctx.businessTimezone;
  const sched = parseScheduleStartEnd(raw, zone);
  const rel = sched.valid
    ? relativeTripLabel(sched.start, zone, raw.status)
    : { label: null, invalid: true };
  const captain = Array.isArray(raw.captains) ? raw.captains[0] : raw.captains;
  const captainName = captain?.full_name ? String(captain.full_name).trim() : null;
  const { mode } = classifyCharterMode(raw);
  const conflictDetails = ctx.conflictsByBooking.get(String(raw.id)) || [];
  const { status: conflictStatus, issues: conflictIssueCodes } = primaryConflictStatus(conflictDetails);
  const cap = capacityLines(raw, ctx.allRaw, zone);
  const turnaround = turnaroundWarningFor(raw, ctx.allRaw, zone);
  const otherTrips = sameDayTripCount(raw, ctx.allRaw, zone);
  const locationRaw = String(raw.rental_location || norm.location || '').trim();

  return {
    id: raw.id,
    bookingId: raw.id,
    customer_name: norm.customer_name,
    customer_phone: norm.customer_phone,
    customer_email: norm.customer_email,
    booking_source: norm.booking_source,
    source_label: bookingSourceDisplay(raw),
    scheduledStart: raw.start_time,
    scheduledEnd: raw.end_time,
    businessTimezone: zone,
    tripDateLong: sched.valid ? formatTripDateLong(sched.start, false) : 'NEEDS SCHEDULING REVIEW',
    tripDateCompact: sched.valid ? formatTripDateLong(sched.start, true) : 'NEEDS SCHEDULING REVIEW',
    relativeDateLabel: rel.invalid ? null : rel.label,
    scheduledTimeDisplay: sched.valid ? formatScheduledTimeRange(sched.start, sched.end, sched.overnight) : 'Time not set',
    groupDateKey: sched.valid ? sched.start.toISODate() : 'needs-review',
    serviceName: serviceNameDetailed(raw),
    trip_type: serviceNameDetailed(raw),
    charterMode: mode,
    passenger_count: cap.guestsOnReservation,
    capacityText: cap.capacityText,
    groupedTripPassengerCount: sharedClusterGuestTotal(raw, ctx.allRaw, zone),
    boatCapacity: CHARTER_MAX_PASSENGERS,
    boat_name: norm.boat_name,
    boatDisplay: raw.boat_id ? norm.boat_name : 'Not assigned',
    boatMissing: !raw.boat_id,
    captainName,
    captainDisplay: captainRequiredForRow(raw)
      ? captainName || 'Not assigned'
      : 'Not required',
    captainMissing: captainRequiredForRow(raw) && !raw.captain_id,
    captainRequired: captainRequiredForRow(raw),
    locationName: locationRaw || 'Departure location not set',
    departureDisplay: locationRaw || 'Departure location not set',
    payment_status: norm.payment_status,
    status: norm.status,
    created_at: raw.created_at,
    is_new: true,
    conflictStatus,
    conflictIssueCodes,
    conflictDetails,
    sameDayTripCount: otherTrips,
    sameDayContext:
      otherTrips > 0 ? `${otherTrips} other trip${otherTrips === 1 ? '' : 's'} scheduled that day` : null,
    turnaroundMinutes: turnaround?.turnaroundMinutes ?? null,
    turnaroundWarning: turnaround?.message ?? null,
    readinessStatus: buildReadinessStatus(norm, raw),
    readiness: readinessLabel(norm),
    waiver_done: norm.waiver_done,
    insurance_done: norm.insurance_done,
    outstanding: norm.outstanding,
    start_time: raw.start_time,
    end_time: raw.end_time,
  };
}

function sortNewBookings(cards, sort) {
  const list = [...cards];
  if (sort === 'recently_booked') {
    list.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    return list;
  }
  if (sort === 'customer_name') {
    list.sort((a, b) =>
      String(a.customer_name).localeCompare(String(b.customer_name), undefined, { sensitivity: 'base' })
    );
    return list;
  }
  list.sort((a, b) => {
    const sa = DateTime.fromISO(String(a.scheduledStart || ''), { zone: 'utc' }).toMillis();
    const sb = DateTime.fromISO(String(b.scheduledStart || ''), { zone: 'utc' }).toMillis();
    if (sa !== sb) return sa - sb;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
  return list;
}

function filterNewBookings(cards, filter, zone) {
  if (!filter) return cards;
  const now = DateTime.now().setZone(zone);
  const today = now.startOf('day');
  const tomorrow = today.plus({ days: 1 });
  return cards.filter((c) => {
    const start = DateTime.fromISO(String(c.scheduledStart || ''), { zone: 'utc' }).setZone(zone);
    switch (filter) {
      case 'today':
        return start.isValid && start >= today && start < today.plus({ days: 1 });
      case 'tomorrow':
        return start.isValid && start >= tomorrow && start < tomorrow.plus({ days: 1 });
      case 'week': {
        if (!start.isValid) return false;
        const weekEnd = today.plus({ days: 7 });
        return start >= today && start < weekEnd;
      }
      case 'weekend': {
        if (!start.isValid) return false;
        const d = start.weekday;
        return d === 5 || d === 6 || d === 7;
      }
      case 'new':
        return c.is_new;
      case 'conflict':
        return c.conflictStatus !== 'No conflict';
      case 'missing_boat':
        return c.boatMissing;
      case 'missing_captain':
        return c.captainMissing;
      case 'direct':
        return String(c.source_label).includes('Direct');
      case 'groupon':
        return String(c.source_label).includes('Groupon');
      case 'staff':
        return String(c.source_label).includes('Staff');
      default:
        return true;
    }
  });
}

function groupNewBookingsByTripDate(cards, zone) {
  const groups = new Map();
  for (const c of cards) {
    const key = c.groupDateKey || 'needs-review';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  const orderedKeys = [...groups.keys()].sort((a, b) => {
    if (a === 'needs-review') return 1;
    if (b === 'needs-review') return -1;
    return a.localeCompare(b);
  });
  const now = DateTime.now().setZone(zone);
  const todayKey = now.startOf('day').toISODate();
  const tomorrowKey = now.plus({ days: 1 }).startOf('day').toISODate();

  return orderedKeys.map((key) => {
    const bookings = groups.get(key);
    let headerRelative = null;
    let headerDate = key === 'needs-review' ? 'NEEDS SCHEDULING REVIEW' : key;
    if (key === todayKey) {
      headerRelative = 'TODAY';
      headerDate = bookings[0]?.tripDateLong || headerDate;
    } else if (key === tomorrowKey) {
      headerRelative = 'TOMORROW';
      headerDate = bookings[0]?.tripDateLong || headerDate;
    } else if (key !== 'needs-review' && bookings[0]?.tripDateLong) {
      headerDate = bookings[0].tripDateCompact || bookings[0].tripDateLong;
    }
    return {
      groupKey: key,
      headerRelative,
      headerDate,
      bookings,
    };
  });
}

function buildNewBookingCards({
  rawRows,
  normalizeRow,
  lastReviewedAt,
  acknowledgedIds,
  scheduleConflicts,
  sort,
  filter,
  businessTimezone,
}) {
  const zone = businessTimezone || getBusinessTimezone();
  const rawById = new Map((rawRows || []).map((r) => [String(r.id), r]));
  let scheduleForRecent = [];
  try {
    const recentNormalized = (rawRows || []).map((r) => normalizeRow(r));
    scheduleForRecent = buildScheduleConflicts(recentNormalized, rawRows || [], zone);
  } catch (err) {
    console.warn('[admin-ops] schedule conflicts for recent bookings:', err?.message || err);
  }
  const conflictsByBooking = indexConflictsByBooking(scheduleForRecent, rawById);
  const ctx = {
    businessTimezone: zone,
    conflictsByBooking,
    allRaw: rawRows || [],
  };

  let cards = [];
  for (const raw of rawRows || []) {
    const norm = normalizeRow(raw);
    if (
      !isBookingNewForAdmin(
        { id: raw.id, created_at: raw.created_at },
        lastReviewedAt,
        acknowledgedIds
      )
    ) {
      continue;
    }
    cards.push(buildNewBookingCard(raw, norm, ctx));
  }

  cards = filterNewBookings(cards, filter, zone);
  cards = sortNewBookings(cards, sort);
  cards = cards.slice(0, NEW_BOOKINGS_LIMIT);
  const grouped = groupNewBookingsByTripDate(cards, zone);
  return { cards, grouped };
}

async function fetchRecentBookingCandidates(supabase, lookbackDays = NEW_BOOKINGS_LOOKBACK_DAYS) {
  const since = DateTime.utc().minus({ days: lookbackDays }).toISO();
  const select =
    'id, customer_id, boat_id, captain_id, start_time, end_time, status, payment_status, booking_source, staff_created, rental_location, booking_type, charter_type, charter_seating, guest_count, waiver_signed, license_status, insurance_status, license_url, insurance_url, hold_expires_at, final_total, total_price, total_amount, deposit_paid, deposit_amount, amount_collected, balance_due, created_at, groupon_voucher_id, stripe_checkout_session_id, external_reference, customers(full_name, email, phone), boats(id, name, type), captains(full_name), waivers(id)';
  const { data, error } = await supabase
    .from('bookings')
    .select(select)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(80);
  if (error) {
    console.warn('[admin-ops] recent bookings:', error.message);
    return [];
  }
  return data || [];
}

function summarizeActionCounts({
  newBookings,
  pendingApprovals,
  pendingPreTrip,
  unreadMessages,
  openPaymentRecovery,
  grouponPending,
  conflicts,
  actionRequired,
}) {
  const pendingWaivers = actionRequired.filter((a) => a.type === 'missing_waiver').length;
  const pendingInsurance = actionRequired.filter((a) => a.type === 'missing_insurance').length;
  const paymentIssues =
    actionRequired.filter((a) => a.type === 'outstanding_balance').length + (openPaymentRecovery || 0);

  return {
    newBookings: newBookings.length,
    pendingApprovals: pendingApprovals + pendingPreTrip,
    pendingWaivers,
    pendingInsurance,
    unreadMessages: unreadMessages || 0,
    paymentIssues,
    grouponPending: grouponPending || 0,
    conflicts: conflicts.length,
  };
}

module.exports = {
  DEFAULT_LAST_REVIEWED,
  NEW_BOOKINGS_LIMIT,
  ADMIN_OPS_MIN_TURNAROUND_MINUTES,
  ALLOWED_SORT,
  ALLOWED_FILTER,
  getBusinessTimezone,
  parseOpsSort,
  parseOpsFilter,
  validateOpsQuery,
  bookingSourceDisplay,
  tripTypeLabel,
  readinessLabel,
  loadReviewState,
  loadAcknowledgedBookingIds,
  isBookingNewForAdmin,
  buildScheduleConflicts,
  computeUpcomingCounts,
  markBookingReviewed,
  markAllBookingsReviewed,
  fetchRecentBookingCandidates,
  summarizeActionCounts,
  detectBoatOverlapConflicts,
  detectSharedDepartureCapacityConflicts,
  detectDuplicateBookingWarnings,
  sharedDepartureGroupKey,
  evaluateSharedCharterCapacity,
  buildNewBookingCards,
  parseScheduleStartEnd,
  relativeTripLabel,
  formatTripDateLong,
  formatScheduledTimeRange,
  classifyCharterMode,
  serviceNameDetailed,
  sortNewBookings,
  filterNewBookings,
  groupNewBookingsByTripDate,
};
