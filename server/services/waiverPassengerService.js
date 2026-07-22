const waiverPassengerLimits = require('../lib/waiverPassengerLimits');
const { replacePassengers } = require('./boatCapacityService');

function logWaiverPassengerFailure(operation, err) {
  const message = err?.message ? String(err.message) : 'unknown error';
  console.error(`[waiver-passenger] operation=${operation} message=${message}`);
}

async function countSavedPassengers(supabase, { bookingId, preTripSubmissionId }) {
  let query = supabase.from('booking_passengers').select('id', { count: 'exact', head: true });
  if (bookingId) query = query.eq('booking_id', bookingId);
  else if (preTripSubmissionId) query = query.eq('pre_trip_submission_id', preTripSubmissionId);
  else return 0;

  const { count, error } = await query;
  if (error) {
    logWaiverPassengerFailure('count_passengers', error);
    return 0;
  }
  return count || 0;
}

async function saveWaiverPassengerSnapshot(
  supabase,
  {
    bookingId,
    preTripSubmissionId,
    boatId,
    passengers,
    load,
    totalGuestWeight,
    customerConfirmedAt,
  }
) {
  const gear = load || {};
  const row = {
    booking_id: bookingId || null,
    pre_trip_submission_id: preTripSubmissionId || null,
    boat_id: boatId || null,
    config_version: 1,
    passenger_count: passengers.length,
    total_persons_aboard: passengers.length,
    passenger_weight_total_lbs: totalGuestWeight,
    operator_weight_lbs: 0,
    cooler_weight_lbs: Number(gear.cooler_weight_lbs || 0),
    personal_gear_weight_lbs: Number(gear.personal_gear_weight_lbs || 0),
    other_equipment_weight_lbs: Number(gear.other_equipment_weight_lbs || 0),
    other_equipment_description: gear.other_equipment_description || null,
    estimated_operating_load_lbs: totalGuestWeight,
    operational_weight_limit_lbs: waiverPassengerLimits.MAX_GUEST_WEIGHT_LBS,
    remaining_margin_lbs: waiverPassengerLimits.MAX_GUEST_WEIGHT_LBS - totalGuestWeight,
    capacity_percent:
      totalGuestWeight > 0
        ? Math.round((totalGuestWeight / waiverPassengerLimits.MAX_GUEST_WEIGHT_LBS) * 10000) / 100
        : 0,
    status: 'within_operating_range',
    threshold_band: 'green',
    customer_confirmed_at: customerConfirmedAt,
    calculated_at: customerConfirmedAt,
  };

  const { data, error } = await supabase
    .from('booking_capacity_calculations')
    .insert(row)
    .select('id')
    .maybeSingle();

  if (error) {
    logWaiverPassengerFailure('insert_snapshot', error);
    return null;
  }
  return data?.id || null;
}

/**
 * Public waiver passenger save — no boat resolution required.
 */
async function runWaiverPassengerCheck(
  supabase,
  {
    bookingId = null,
    preTripSubmissionId = null,
    boatId = null,
    passengers,
    expectedPassengerCount = null,
    load = {},
    tripContext = {},
    customerConfirmed = false,
    persist = true,
  }
) {
  const validation = waiverPassengerLimits.validateWaiverPassengers(
    passengers,
    expectedPassengerCount ?? passengers?.length,
    tripContext
  );

  if (!validation.ok) {
    const err = new Error(validation.message);
    err.statusCode = 400;
    err.code = validation.code;
    err.details = validation;
    throw err;
  }

  let calculationId = null;
  if (persist && customerConfirmed) {
    await replacePassengers(supabase, {
      bookingId,
      preTripSubmissionId,
      passengers: validation.passengers,
    });

    calculationId = await saveWaiverPassengerSnapshot(supabase, {
      bookingId,
      preTripSubmissionId,
      boatId: boatId || null,
      passengers: validation.passengers,
      load,
      totalGuestWeight: validation.totalGuestWeight,
      customerConfirmedAt: new Date().toISOString(),
    });
  }

  return {
    validation,
    calculationId,
    result: waiverPassengerLimits.toPublicWaiverPassengerResult(validation, { calculationId }),
  };
}

async function attachWaiverPassengerFieldsToPublicBooking(supabase, publicRow, bookingId) {
  const [{ data: latest }, passengerCount] = await Promise.all([
    supabase
      .from('booking_capacity_calculations')
      .select('status, customer_confirmed_at')
      .eq('booking_id', bookingId)
      .order('calculated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    countSavedPassengers(supabase, { bookingId }),
  ]);

  const completed = Boolean(latest?.customer_confirmed_at) || passengerCount > 0;
  const status = latest?.status || (completed ? 'within_operating_range' : null);

  return {
    ...publicRow,
    boat_capacity_verified: true,
    capacity_status: status,
    capacity_completed: completed,
  };
}

module.exports = {
  runWaiverPassengerCheck,
  attachWaiverPassengerFieldsToPublicBooking,
  countSavedPassengers,
};
