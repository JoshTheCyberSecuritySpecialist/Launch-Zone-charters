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
const NEW_BOOKINGS_LIMIT = 25;

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
        continue;
      }

      const cluster = active.filter((row) => {
        const s = new Date(row.start_time).getTime();
        const e = new Date(row.end_time).getTime();
        return intervalsOverlap(aStart, aEnd, s, e) || intervalsOverlap(bStart, bEnd, s, e);
      });
      const used = cluster.reduce((sum, row) => {
        if (!isSharedCharterBooking(row) && isExclusiveBoatBooking(row)) {
          return CHARTER_MAX_PASSENGERS;
        }
        if (isSharedCharterBooking(row)) {
          const gc = Number(row.guest_count || row.passenger_count || 1);
          return sum + (Number.isFinite(gc) ? gc : CHARTER_MAX_PASSENGERS);
        }
        return sum;
      }, 0);
      if (used > CHARTER_MAX_PASSENGERS) {
        conflicts.push({
          type: 'shared_capacity_exceeded',
          label: `Shared charter seats may exceed ${CHARTER_MAX_PASSENGERS} for this time slot`,
          booking_id: a.id,
          other_booking_id: b.id,
          boat_id: a.boat_id,
          urgency: 14,
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

function detectAssignmentWarnings(bookings) {
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
    const endMs = new Date(b.end_time).getTime();
    const startMs = new Date(b.start_time).getTime();
    if (Number.isFinite(endMs) && Number.isFinite(startMs) && endMs <= startMs) {
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

/**
 * @param {Array} normalizedBookings - ops-shaped rows with boat_id, times, etc.
 * @param {Array} rawRows - DB rows for capacity helpers
 */
function buildScheduleConflicts(normalizedBookings, rawRows) {
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
  conflicts.push(...detectCaptainOverlapConflicts(rawRows || []));
  conflicts.push(...detectAssignmentWarnings(normalizedBookings));

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

async function fetchRecentBookingCandidates(supabase, lookbackDays = NEW_BOOKINGS_LOOKBACK_DAYS) {
  const since = DateTime.utc().minus({ days: lookbackDays }).toISO();
  const select =
    'id, customer_id, boat_id, captain_id, start_time, end_time, status, payment_status, booking_source, staff_created, rental_location, booking_type, charter_type, charter_seating, guest_count, waiver_signed, license_status, insurance_status, license_url, insurance_url, hold_expires_at, final_total, total_price, total_amount, deposit_paid, deposit_amount, amount_collected, balance_due, created_at, customers(full_name, email, phone), boats(id, name, type), waivers(id)';
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
  evaluateSharedCharterCapacity,
};
