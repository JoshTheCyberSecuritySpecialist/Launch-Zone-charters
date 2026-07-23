const { DateTime } = require('luxon');
const boatCapacityService = require('./boatCapacityService');

const BUSINESS_TZ = 'America/New_York';
const CAPTAIN_CHARTER_TYPE = 'captain_charter';

const LIST_SELECT =
  'id, start_time, end_time, status, captain_progress, guest_count, rental_location, charter_type, booking_type, special_requests, staff_notes, emergency_contact_notes, waiver_signed, license_status, insurance_status, payment_status, customers(full_name, phone), boats(id, name, type)';

const DETAIL_SELECT =
  'id, start_time, end_time, status, captain_progress, guest_count, rental_location, charter_type, booking_type, special_requests, staff_notes, emergency_contact_notes, waiver_signed, license_status, insurance_status, payment_status, captain_id, customers(full_name, phone, email), boats(id, name, type), captains(id, full_name)';

const PASSENGER_SELECT =
  'id, passenger_number, passenger_name, passenger_type, mobility_assistance_required, mobility_notes';

const PROGRESS_VALUES = ['not_started', 'arrived', 'in_progress', 'completed'];

const PROGRESS_ACTIONS = {
  arrived: { from: ['not_started'], to: 'arrived', label: 'Mark arrived' },
  start: { from: ['arrived'], to: 'in_progress', label: 'Start trip' },
  complete: { from: ['in_progress'], to: 'completed', label: 'Complete trip' },
};

function unwrapJoin(row, key) {
  if (!row) return null;
  const value = row[key];
  return Array.isArray(value) ? value[0] || null : value || null;
}

function paymentDisplayStatus(booking) {
  const paymentStatus = String(booking?.payment_status || '').toLowerCase();
  const status = String(booking?.status || '').toLowerCase();
  if (paymentStatus === 'paid' || paymentStatus === 'deposit_paid') return 'Ready';
  if (['pending_verification', 'confirmed', 'ready_for_departure', 'completed'].includes(status)) {
    return 'Ready';
  }
  return 'Action Required';
}

function hasNotesIndicator(booking) {
  return Boolean(
    String(booking?.special_requests || '').trim() ||
      String(booking?.staff_notes || '').trim() ||
      String(booking?.emergency_contact_notes || '').trim()
  );
}

function buildVerificationSummary(booking, capacityStatus, options = {}) {
  const includeCapacity = options.includeCapacity !== false;
  const isCharter = booking?.booking_type === 'charter';
  const payment = paymentDisplayStatus(booking);
  const capacityDone = Boolean(capacityStatus && capacityStatus !== 'capacity_unverified');
  const items = [
    {
      key: 'waiver',
      label: 'Waiver signed',
      done: Boolean(booking?.waiver_signed),
      note: booking?.waiver_signed ? 'On file' : 'Still needed',
    },
  ];

  if (includeCapacity) {
    items.push({
      key: 'capacity',
      label: 'Passenger & safety information',
      done: capacityDone,
      note: !capacityDone
        ? 'Not completed'
        : capacityStatus === 'captain_review_required'
          ? 'Saved — captain review before departure'
          : 'Saved for assigned boat',
    });
  }

  if (!isCharter) {
    items.push(
      {
        key: 'license',
        label: 'License / ID',
        done: booking?.license_status === 'verified',
        note:
          booking?.license_status === 'verified'
            ? 'Verified'
            : booking?.license_status === 'rejected'
              ? 'Rejected — contact operations'
              : 'Pending',
      },
      {
        key: 'insurance',
        label: 'Insurance',
        done: ['verified', 'submitted'].includes(String(booking?.insurance_status || '')),
        note:
          booking?.insurance_status === 'verified'
            ? 'Verified'
            : booking?.insurance_status === 'submitted'
              ? 'Submitted — under review'
              : booking?.insurance_status === 'rejected'
                ? 'Rejected — contact operations'
                : 'Pending',
      }
    );
  } else {
    items.push({
      key: 'insurance',
      label: 'Captain-led charter insurance',
      done: true,
      note: 'Not required unless operations contacts you',
    });
  }

  items.push(
    {
      key: 'review',
      label: 'Operations review',
      done: ['confirmed', 'ready_for_departure', 'completed'].includes(String(booking?.status || '')),
      note: ['confirmed', 'ready_for_departure', 'completed'].includes(String(booking?.status || ''))
        ? 'Approved by staff'
        : 'Pending staff review',
    },
    {
      key: 'payment',
      label: 'Payment',
      done: payment === 'Ready',
      note: payment,
    }
  );

  const missingCount = items.filter((item) => !item.done).length;
  return {
    items,
    ready_count: items.filter((item) => item.done).length,
    missing_count: missingCount,
    payment_display: payment,
  };
}

function sanitizeListBooking(row) {
  const customer = unwrapJoin(row, 'customers');
  const boat = unwrapJoin(row, 'boats');
  const verification = buildVerificationSummary(row, null, { includeCapacity: false });

  return {
    id: row.id,
    start_time: row.start_time,
    end_time: row.end_time,
    status: row.status,
    captain_progress: row.captain_progress || 'not_started',
    guest_count: Number(row.guest_count || 1),
    rental_location: row.rental_location || null,
    charter_type: row.charter_type || CAPTAIN_CHARTER_TYPE,
    customer_name: customer?.full_name || 'Guest',
    customer_phone: customer?.phone || null,
    boat_name: boat?.name || 'Unassigned boat',
    boat_id: boat?.id || null,
    verification_summary: {
      ready_count: verification.ready_count,
      missing_count: verification.missing_count,
      payment_display: verification.payment_display,
    },
    has_notes: hasNotesIndicator(row),
  };
}

function sanitizeBookingDetail(row, passengers, capacityStatus) {
  const customer = unwrapJoin(row, 'customers');
  const boat = unwrapJoin(row, 'boats');
  const captain = unwrapJoin(row, 'captains');
  const verification = buildVerificationSummary(row, capacityStatus);

  return {
    id: row.id,
    start_time: row.start_time,
    end_time: row.end_time,
    status: row.status,
    captain_progress: row.captain_progress || 'not_started',
    guest_count: Number(row.guest_count || 1),
    rental_location: row.rental_location || null,
    charter_type: row.charter_type || CAPTAIN_CHARTER_TYPE,
    customer: {
      full_name: customer?.full_name || 'Guest',
      phone: customer?.phone || null,
      email: customer?.email || null,
    },
    boat: boat
      ? {
          id: boat.id,
          name: boat.name,
          type: boat.type || null,
        }
      : null,
    captain: captain
      ? {
          id: captain.id,
          full_name: captain.full_name,
        }
      : null,
    trip_notes: {
      special_requests: row.special_requests || null,
      staff_notes: row.staff_notes || null,
    },
    emergency_contact_notes: row.emergency_contact_notes || null,
    waiver_status: row.waiver_signed ? 'signed' : 'pending',
    license_status: row.license_status || 'pending',
    insurance_status: row.insurance_status || 'pending',
    payment_display: verification.payment_display,
    verification_summary: verification,
    capacity_status: capacityStatus || null,
    passengers: (passengers || []).map((p) => ({
      passenger_number: p.passenger_number,
      passenger_name: p.passenger_name,
      passenger_type: p.passenger_type,
      mobility_assistance_required: Boolean(p.mobility_assistance_required),
      mobility_notes: p.mobility_notes || null,
    })),
  };
}

function resolveCaptainRange(query = {}, cleanText = String) {
  const view = cleanText(query.view, 20).toLowerCase() || 'agenda';
  const fromRaw = cleanText(query.from, 80);
  const toRaw = cleanText(query.to, 80);
  const now = DateTime.now().setZone(BUSINESS_TZ);

  if (fromRaw && toRaw) {
    const from = new Date(fromRaw);
    const to = new Date(toRaw);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to.getTime() <= from.getTime()) {
      const err = new Error('Valid from and to range is required.');
      err.statusCode = 400;
      throw err;
    }
    return { fromIso: from.toISOString(), toIso: to.toISOString(), view: 'custom' };
  }

  if (view === 'today') {
    return {
      fromIso: now.startOf('day').toUTC().toISO(),
      toIso: now.endOf('day').toUTC().toISO(),
      view,
    };
  }
  if (view === 'week') {
    return {
      fromIso: now.startOf('week').toUTC().toISO(),
      toIso: now.endOf('week').toUTC().toISO(),
      view,
    };
  }
  if (view === 'month') {
    return {
      fromIso: now.startOf('month').toUTC().toISO(),
      toIso: now.endOf('month').toUTC().toISO(),
      view,
    };
  }

  return {
    fromIso: now.startOf('day').toUTC().toISO(),
    toIso: now.plus({ days: 14 }).endOf('day').toUTC().toISO(),
    view: 'agenda',
  };
}

function resolveProgressAction(rawAction) {
  const action = String(rawAction || '')
    .trim()
    .toLowerCase();
  if (!action || !PROGRESS_ACTIONS[action]) {
    const err = new Error('Unknown progress action. Use arrived, start, or complete.');
    err.statusCode = 422;
    throw err;
  }
  return PROGRESS_ACTIONS[action];
}

function resolveProgressUpdate(currentProgress, actionKey) {
  const current = String(currentProgress || 'not_started');
  const rule = resolveProgressAction(actionKey);

  if (current === rule.to) {
    const err = new Error(`Trip is already marked ${rule.to.replace(/_/g, ' ')}.`);
    err.statusCode = 422;
    throw err;
  }
  if (!rule.from.includes(current)) {
    const err = new Error(`Cannot ${actionKey} trip while progress is ${current.replace(/_/g, ' ')}.`);
    err.statusCode = 422;
    throw err;
  }

  return {
    previousProgress: current,
    nextProgress: rule.to,
    action: actionKey,
    label: rule.label,
  };
}

async function listCaptainBookings(supabase, captainId, range) {
  const { data, error } = await supabase
    .from('bookings')
    .select(LIST_SELECT)
    .eq('captain_id', captainId)
    .eq('booking_type', 'charter')
    .eq('charter_type', CAPTAIN_CHARTER_TYPE)
    .neq('status', 'cancelled')
    .lt('start_time', range.toIso)
    .gt('end_time', range.fromIso)
    .order('start_time', { ascending: true });

  if (error) throw error;
  return (Array.isArray(data) ? data : []).map(sanitizeListBooking);
}

async function loadCaptainBookingRow(supabase, captainId, bookingId) {
  const { data, error } = await supabase
    .from('bookings')
    .select(DETAIL_SELECT)
    .eq('id', bookingId)
    .eq('captain_id', captainId)
    .eq('booking_type', 'charter')
    .eq('charter_type', CAPTAIN_CHARTER_TYPE)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function loadCaptainBookingDetail(supabase, captainId, bookingId) {
  const booking = await loadCaptainBookingRow(supabase, captainId, bookingId);
  if (!booking?.id) return null;

  const [{ data: passengers }, capacityCalculation] = await Promise.all([
    supabase
      .from('booking_passengers')
      .select(PASSENGER_SELECT)
      .eq('booking_id', bookingId)
      .order('passenger_number', { ascending: true }),
    boatCapacityService.getLatestCapacityCalculation(supabase, { bookingId }),
  ]);

  return sanitizeBookingDetail(
    booking,
    Array.isArray(passengers) ? passengers : [],
    capacityCalculation?.status || null
  );
}

async function applyCaptainProgressUpdate(supabase, {
  captainId,
  captainAuthUserId,
  bookingId,
  action,
}) {
  const booking = await loadCaptainBookingRow(supabase, captainId, bookingId);
  if (!booking?.id) {
    const err = new Error('Booking not found.');
    err.statusCode = 404;
    throw err;
  }

  const transition = resolveProgressUpdate(booking.captain_progress, action);
  const { data: updated, error } = await supabase
    .from('bookings')
    .update({ captain_progress: transition.nextProgress })
    .eq('id', bookingId)
    .eq('captain_id', captainId)
    .eq('captain_progress', transition.previousProgress)
    .select('id, captain_progress')
    .maybeSingle();

  if (error) throw error;

  if (!updated?.id) {
    const { data: latest } = await supabase
      .from('bookings')
      .select('captain_progress')
      .eq('id', bookingId)
      .eq('captain_id', captainId)
      .maybeSingle();

    if (latest?.captain_progress === transition.nextProgress) {
      const err = new Error(`Trip is already marked ${transition.nextProgress.replace(/_/g, ' ')}.`);
      err.statusCode = 422;
      throw err;
    }

    const err = new Error('Could not update trip progress. Refresh and try again.');
    err.statusCode = 409;
    throw err;
  }

  return {
    booking_id: bookingId,
    previous_progress: transition.previousProgress,
    captain_progress: transition.nextProgress,
    action: transition.action,
    message: transition.label,
    actor_id: captainAuthUserId,
  };
}

module.exports = {
  BUSINESS_TZ,
  CAPTAIN_CHARTER_TYPE,
  PROGRESS_VALUES,
  PROGRESS_ACTIONS,
  paymentDisplayStatus,
  buildVerificationSummary,
  sanitizeListBooking,
  sanitizeBookingDetail,
  resolveCaptainRange,
  resolveProgressUpdate,
  listCaptainBookings,
  loadCaptainBookingDetail,
  applyCaptainProgressUpdate,
};
