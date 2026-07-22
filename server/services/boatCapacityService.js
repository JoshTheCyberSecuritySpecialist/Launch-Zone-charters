const boatSafetyCapacity = require('../lib/boatSafetyCapacity');

function logCapacityFailure(table, operation, err) {
  const code = err?.code ? String(err.code) : 'unknown';
  const message = err?.message ? String(err.message) : 'unknown error';
  console.error(`[boat-capacity] table=${table} operation=${operation} code=${code} message=${message}`);
}

async function loadCapacityProfile(supabase, boatId) {
  const { data, error } = await supabase
    .from('boat_capacity_profiles')
    .select('*')
    .eq('boat_id', boatId)
    .maybeSingle();

  if (error) {
    logCapacityFailure('boat_capacity_profiles', 'select', error);
    const err = new Error('Could not load boat capacity profile');
    err.statusCode = 500;
    throw err;
  }
  return data;
}

async function loadBookingForCapacity(supabase, bookingId) {
  const { data, error } = await supabase
    .from('bookings')
    .select('id, boat_id, booking_type, charter_type, captain_included, guest_count, status')
    .eq('id', bookingId)
    .maybeSingle();

  if (error) {
    logCapacityFailure('bookings', 'select', error);
    const err = new Error('Could not load booking');
    err.statusCode = 500;
    throw err;
  }
  if (!data) {
    const err = new Error('Booking not found');
    err.statusCode = 404;
    throw err;
  }
  return data;
}

function tripContextFromBooking(booking) {
  return {
    bookingType: booking.booking_type,
    charterType: booking.charter_type,
    captainIncluded: Boolean(booking.captain_included) || String(booking.booking_type || '') === 'charter',
  };
}

async function replacePassengers(supabase, { bookingId, preTripSubmissionId, passengers }) {
  if (bookingId) {
    const { error: delErr } = await supabase.from('booking_passengers').delete().eq('booking_id', bookingId);
    if (delErr) logCapacityFailure('booking_passengers', 'delete', delErr);
  }
  if (preTripSubmissionId) {
    const { error: delErr } = await supabase
      .from('booking_passengers')
      .delete()
      .eq('pre_trip_submission_id', preTripSubmissionId);
    if (delErr) logCapacityFailure('booking_passengers', 'delete_pretrip', delErr);
  }

  if (!passengers?.length) return;

  const rows = passengers.map((p, index) => ({
    booking_id: bookingId || null,
    pre_trip_submission_id: preTripSubmissionId || null,
    passenger_number: p.passenger_number ?? index + 1,
    passenger_name: p.passenger_name,
    passenger_type: p.passenger_type,
    weight_lbs: p.weight_lbs,
    life_jacket_size: p.life_jacket_size,
    mobility_assistance_required: Boolean(p.mobility_assistance_required),
    mobility_notes: p.mobility_notes,
  }));

  const { error: insErr } = await supabase.from('booking_passengers').insert(rows);
  if (insErr) {
    logCapacityFailure('booking_passengers', 'insert', insErr);
    const err = new Error('Could not save passenger manifest');
    err.statusCode = 500;
    throw err;
  }
}

async function saveCapacityCalculation(supabase, { bookingId, preTripSubmissionId, boatId, result, customerConfirmedAt }) {
  const totals = result.totals;
  const row = {
    booking_id: bookingId || null,
    pre_trip_submission_id: preTripSubmissionId || null,
    boat_id: boatId,
    config_version: result.config_version || 1,
    passenger_count: totals.passenger_count,
    total_persons_aboard: totals.total_persons_aboard,
    passenger_weight_total_lbs: totals.passenger_weight_total_lbs,
    operator_weight_lbs: totals.operator_weight_lbs,
    cooler_weight_lbs: totals.cooler_weight_lbs,
    personal_gear_weight_lbs: totals.personal_gear_weight_lbs,
    other_equipment_weight_lbs: totals.other_equipment_weight_lbs,
    other_equipment_description: totals.other_equipment_description,
    estimated_operating_load_lbs: totals.estimated_operating_load_lbs,
    operational_weight_limit_lbs: totals.operational_weight_limit_lbs,
    remaining_margin_lbs: totals.remaining_margin_lbs,
    capacity_percent: totals.capacity_percent,
    status: result.status,
    threshold_band: result.threshold_band,
    customer_confirmed_at: customerConfirmedAt || null,
    calculated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase.from('booking_capacity_calculations').insert(row).select('id').maybeSingle();
  if (error) {
    logCapacityFailure('booking_capacity_calculations', 'insert', error);
    const err = new Error('Could not save capacity calculation');
    err.statusCode = 500;
    throw err;
  }
  return data;
}

async function getLatestCapacityCalculation(supabase, { bookingId, preTripSubmissionId }) {
  let query = supabase
    .from('booking_capacity_calculations')
    .select('*')
    .order('calculated_at', { ascending: false })
    .limit(1);

  if (bookingId) query = query.eq('booking_id', bookingId);
  else if (preTripSubmissionId) query = query.eq('pre_trip_submission_id', preTripSubmissionId);
  else return null;

  const { data, error } = await query.maybeSingle();
  if (error) {
    logCapacityFailure('booking_capacity_calculations', 'select_latest', error);
    return null;
  }
  return data;
}

/**
 * Run calculator for a booking, optionally persist manifest + snapshot.
 */
async function runCapacityCheckForBooking(
  supabase,
  {
    bookingId,
    preTripSubmissionId = null,
    passengers,
    expectedPassengerCount = null,
    load = {},
    customerConfirmed = false,
    persist = true,
  }
) {
  const booking = await loadBookingForCapacity(supabase, bookingId);
  if (!booking.boat_id) {
    const err = new Error('No boat assigned to this booking yet.');
    err.statusCode = 400;
    err.code = 'boat_assignment_pending';
    throw err;
  }

  const passengerValidation = boatSafetyCapacity.validatePassengers(
    passengers,
    expectedPassengerCount ?? passengers?.length
  );
  if (!passengerValidation.valid) {
    const err = new Error('Passenger information is incomplete or invalid.');
    err.statusCode = 400;
    err.code = 'invalid_passengers';
    err.details = passengerValidation.errors;
    throw err;
  }

  const profile = await loadCapacityProfile(supabase, booking.boat_id);
  const result = boatSafetyCapacity.calculateBoatSafetyCapacity({
    profile,
    passengers: passengerValidation.passengers,
    load,
    tripContext: tripContextFromBooking(booking),
  });

  let calculationId = null;
  if (persist) {
    if (customerConfirmed !== true) {
      const err = new Error('Customer confirmation is required to save capacity information.');
      err.statusCode = 400;
      err.code = 'confirmation_required';
      throw err;
    }

    await replacePassengers(supabase, {
      bookingId,
      preTripSubmissionId,
      passengers: passengerValidation.passengers,
    });

    const saved = await saveCapacityCalculation(supabase, {
      bookingId,
      preTripSubmissionId,
      boatId: booking.boat_id,
      result,
      customerConfirmedAt: new Date().toISOString(),
    });
    calculationId = saved?.id || null;
  }

  return {
    booking,
    profile,
    result,
    calculationId,
    passengers: passengerValidation.passengers,
  };
}

/**
 * Pre-trip approve gate: block approve when latest saved calculation exceeded capacity.
 */
async function evaluateCapacityApprovalGate(supabase, bookingId) {
  const latest = await getLatestCapacityCalculation(supabase, { bookingId });
  if (!latest) {
    return { allowApprove: true, warning: null, calculation: null };
  }

  if (latest.status === boatSafetyCapacity.CAPACITY_STATUS.EXCEEDED) {
    return {
      allowApprove: false,
      warning: 'Latest capacity calculation exceeds the operating limit for the assigned boat.',
      calculation: latest,
    };
  }

  if (latest.status === boatSafetyCapacity.CAPACITY_STATUS.UNVERIFIED) {
    return {
      allowApprove: true,
      warning: 'Boat capacity plate data is not verified. Captain must confirm limits before departure.',
      calculation: latest,
    };
  }

  if (latest.status === boatSafetyCapacity.CAPACITY_STATUS.REVIEW) {
    return {
      allowApprove: true,
      warning: 'Latest capacity calculation requires captain review before departure.',
      calculation: latest,
    };
  }

  return { allowApprove: true, warning: null, calculation: latest };
}

module.exports = {
  loadCapacityProfile,
  loadBookingForCapacity,
  tripContextFromBooking,
  replacePassengers,
  saveCapacityCalculation,
  getLatestCapacityCalculation,
  runCapacityCheckForBooking,
  evaluateCapacityApprovalGate,
};
