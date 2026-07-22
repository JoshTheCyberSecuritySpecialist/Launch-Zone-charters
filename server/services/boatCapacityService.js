const boatSafetyCapacity = require('../lib/boatSafetyCapacity');

const TRIP_TYPE_BOAT_TYPE = {
  pontoon_rental: 'standard',
  center_console_rental: 'premium',
  captain_charter: 'premium',
};

const TRIP_TYPE_REGISTRATION = {
  pontoon_rental: 'FL0278PU',
  center_console_rental: 'FL3827TT',
};

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

function tripContextFromTripType(tripType) {
  const normalized = String(tripType || '').trim();
  return {
    bookingType: normalized === 'captain_charter' ? 'charter' : 'rental',
    charterType: normalized === 'captain_charter' ? 'captain_charter' : null,
    captainIncluded: normalized === 'captain_charter',
  };
}

async function resolveBoatIdForTripType(supabase, tripType) {
  const normalized = String(tripType || '').trim();
  const registration = TRIP_TYPE_REGISTRATION[normalized];
  if (registration) {
    const { data: profiles, error } = await supabase
      .from('boat_capacity_profiles')
      .select('boat_id, registration_number, boats!inner(id, is_active, type)')
      .eq('boats.is_active', true);

    if (!error && Array.isArray(profiles)) {
      const match = profiles.find((row) => {
        const reg = String(row.registration_number || '')
          .trim()
          .toUpperCase();
        return reg === registration.toUpperCase();
      });
      if (match?.boat_id) return match.boat_id;
    }
  }

  const boatType = TRIP_TYPE_BOAT_TYPE[normalized];
  if (!boatType) return null;

  const { data, error } = await supabase
    .from('boats')
    .select('id')
    .eq('type', boatType)
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    logCapacityFailure('boats', 'select_by_trip_type', error);
    return null;
  }
  return data?.id || null;
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

async function runCapacityCore(supabase, {
  boatId,
  tripContext,
  bookingId = null,
  preTripSubmissionId = null,
  passengers,
  expectedPassengerCount = null,
  load = {},
  customerConfirmed = false,
  persist = true,
  allowExceededPersist = false,
}) {
  if (!boatId) {
    const err = new Error('Could not determine boat for this trip.');
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

  const profile = await loadCapacityProfile(supabase, boatId);
  const result = boatSafetyCapacity.calculateBoatSafetyCapacity({
    profile,
    passengers: passengerValidation.passengers,
    load,
    tripContext,
  });

  let calculationId = null;
  if (persist) {
    if (customerConfirmed !== true) {
      const err = new Error('Customer confirmation is required to save capacity information.');
      err.statusCode = 400;
      err.code = 'confirmation_required';
      throw err;
    }

    if (result.status === boatSafetyCapacity.CAPACITY_STATUS.EXCEEDED && !allowExceededPersist) {
      const err = new Error(result.message);
      err.statusCode = 400;
      err.code = 'capacity_exceeded';
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
      boatId,
      result,
      customerConfirmedAt: new Date().toISOString(),
    });
    calculationId = saved?.id || null;
  }

  return {
    boatId,
    profile,
    result,
    calculationId,
    passengers: passengerValidation.passengers,
  };
}

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

  const run = await runCapacityCore(supabase, {
    boatId: booking.boat_id,
    tripContext: tripContextFromBooking(booking),
    bookingId,
    preTripSubmissionId,
    passengers,
    expectedPassengerCount,
    load,
    customerConfirmed,
    persist,
  });

  return { booking, ...run };
}

async function runCapacityCheckForTripType(
  supabase,
  {
    tripType,
    preTripSubmissionId = null,
    passengers,
    expectedPassengerCount = null,
    load = {},
    customerConfirmed = false,
    persist = true,
  }
) {
  const boatId = await resolveBoatIdForTripType(supabase, tripType);
  return runCapacityCore(supabase, {
    boatId,
    tripContext: tripContextFromTripType(tripType),
    preTripSubmissionId,
    passengers,
    expectedPassengerCount,
    load,
    customerConfirmed,
    persist,
  });
}

async function attachCapacityFieldsToPublicBooking(supabase, publicRow, bookingId) {
  const [latest, profile] = await Promise.all([
    getLatestCapacityCalculation(supabase, { bookingId }),
    publicRow.boat_id ? loadCapacityProfile(supabase, publicRow.boat_id) : Promise.resolve(null),
  ]);

  return {
    ...publicRow,
    boat_capacity_verified: profile?.capacity_verified === true,
    capacity_status: latest?.status || null,
    capacity_completed: Boolean(latest?.customer_confirmed_at),
  };
}

async function evaluateCapacityApprovalGate(supabase, bookingId) {
  const latest = await getLatestCapacityCalculation(supabase, { bookingId });
  if (!latest) {
    return { allowApprove: true, warning: null, calculation: null };
  }

  const effective = await getEffectiveCapacityStatus(supabase, latest);

  if (effective.status === boatSafetyCapacity.CAPACITY_STATUS.EXCEEDED) {
    return {
      allowApprove: false,
      warning: 'Latest capacity calculation exceeds the operating limit for the assigned boat.',
      calculation: latest,
      effective_status: effective.status,
    };
  }

  if (effective.status === boatSafetyCapacity.CAPACITY_STATUS.UNVERIFIED) {
    return {
      allowApprove: true,
      warning: 'Boat capacity plate data is not verified. Captain must confirm limits before departure.',
      calculation: latest,
      effective_status: effective.status,
    };
  }

  if (effective.status === boatSafetyCapacity.CAPACITY_STATUS.REVIEW) {
    return {
      allowApprove: true,
      warning: 'Latest capacity calculation requires captain review before departure.',
      calculation: latest,
      effective_status: effective.status,
    };
  }

  return { allowApprove: true, warning: null, calculation: latest, effective_status: effective.status };
}

async function getCapacityOverrides(supabase, calculationId) {
  const { data, error } = await supabase
    .from('capacity_calculation_overrides')
    .select('id, original_status, override_status, reason, overridden_by, overridden_at')
    .eq('calculation_id', calculationId)
    .order('overridden_at', { ascending: false });

  if (error) {
    logCapacityFailure('capacity_calculation_overrides', 'select', error);
    return [];
  }
  return data || [];
}

async function getEffectiveCapacityStatus(supabase, calculation) {
  if (!calculation?.id) {
    return { status: boatSafetyCapacity.CAPACITY_STATUS.UNVERIFIED, override: null };
  }

  const overrides = await getCapacityOverrides(supabase, calculation.id);
  const latestOverride = overrides[0] || null;
  if (latestOverride) {
    return { status: latestOverride.override_status, override: latestOverride, calculated_status: calculation.status };
  }

  return { status: calculation.status, override: null, calculated_status: calculation.status };
}

function passengersToCalculatorInput(rows) {
  return (rows || []).map((row) => ({
    passenger_name: row.passenger_name,
    passenger_type: row.passenger_type,
    weight_lbs: row.weight_lbs,
    life_jacket_size: row.life_jacket_size,
    mobility_assistance_required: row.mobility_assistance_required,
    mobility_notes: row.mobility_notes,
  }));
}

function loadFromCalculation(calculation) {
  return {
    cooler_weight_lbs: calculation?.cooler_weight_lbs || 0,
    personal_gear_weight_lbs: calculation?.personal_gear_weight_lbs || 0,
    other_equipment_weight_lbs: calculation?.other_equipment_weight_lbs || 0,
    other_equipment_description: calculation?.other_equipment_description || undefined,
  };
}

/**
 * Recalculate from saved passenger manifest + last gear snapshot against current boat profile.
 */
async function recalculateCapacityFromManifest(supabase, bookingId) {
  const booking = await loadBookingForCapacity(supabase, bookingId);
  if (!booking.boat_id) return null;

  const { data: passengers, error: pErr } = await supabase
    .from('booking_passengers')
    .select(
      'passenger_number, passenger_name, passenger_type, weight_lbs, life_jacket_size, mobility_assistance_required, mobility_notes'
    )
    .eq('booking_id', bookingId)
    .order('passenger_number', { ascending: true });

  if (pErr) {
    logCapacityFailure('booking_passengers', 'select_recalc', pErr);
    const err = new Error('Could not load passenger manifest');
    err.statusCode = 500;
    throw err;
  }

  if (!passengers?.length) return null;

  const previous = await getLatestCapacityCalculation(supabase, { bookingId });
  const load = loadFromCalculation(previous);

  return runCapacityCore(supabase, {
    boatId: booking.boat_id,
    tripContext: tripContextFromBooking(booking),
    bookingId,
    passengers: passengersToCalculatorInput(passengers),
    expectedPassengerCount: passengers.length,
    load,
    customerConfirmed: true,
    persist: true,
    allowExceededPersist: true,
  });
}

async function applyCapacityOverride(
  supabase,
  { calculationId, overrideStatus, reason, adminUserId }
) {
  const trimmedReason = String(reason || '').trim();
  if (!trimmedReason || trimmedReason.length < 8) {
    const err = new Error('A written reason (at least 8 characters) is required for capacity overrides.');
    err.statusCode = 400;
    throw err;
  }

  const allowed = new Set([
    boatSafetyCapacity.CAPACITY_STATUS.WITHIN,
    boatSafetyCapacity.CAPACITY_STATUS.REVIEW,
  ]);
  if (!allowed.has(overrideStatus)) {
    const err = new Error('Override status must be within_operating_range or captain_review_required.');
    err.statusCode = 400;
    throw err;
  }

  const { data: calculation, error: cErr } = await supabase
    .from('booking_capacity_calculations')
    .select('id, status, booking_id')
    .eq('id', calculationId)
    .maybeSingle();

  if (cErr || !calculation) {
    const err = new Error('Capacity calculation not found');
    err.statusCode = 404;
    throw err;
  }

  const { data, error } = await supabase
    .from('capacity_calculation_overrides')
    .insert({
      calculation_id: calculationId,
      original_status: calculation.status,
      override_status: overrideStatus,
      reason: trimmedReason,
      overridden_by: adminUserId || null,
    })
    .select('id, original_status, override_status, reason, overridden_by, overridden_at')
    .maybeSingle();

  if (error) {
    logCapacityFailure('capacity_calculation_overrides', 'insert', error);
    const err = new Error('Could not save capacity override');
    err.statusCode = 500;
    throw err;
  }

  return { override: data, calculation, booking_id: calculation.booking_id };
}

async function getCapacityDetailForBooking(supabase, bookingId) {
  const [calculation, passengersResult, bookingRow] = await Promise.all([
    getLatestCapacityCalculation(supabase, { bookingId }),
    supabase
      .from('booking_passengers')
      .select(
        'id, passenger_number, passenger_name, passenger_type, weight_lbs, life_jacket_size, mobility_assistance_required, mobility_notes, created_at'
      )
      .eq('booking_id', bookingId)
      .order('passenger_number', { ascending: true }),
    supabase
      .from('bookings')
      .select('boat_id, guest_count, booking_type, captain_included, boats(id, name, type)')
      .eq('id', bookingId)
      .maybeSingle(),
  ]);

  if (passengersResult.error) throw passengersResult.error;

  const boat = Array.isArray(bookingRow.data?.boats)
    ? bookingRow.data.boats[0]
    : bookingRow.data?.boats;

  let profile = null;
  if (bookingRow.data?.boat_id) {
    profile = await loadCapacityProfile(supabase, bookingRow.data.boat_id);
  }

  let overrides = [];
  let effective = {
    status: boatSafetyCapacity.CAPACITY_STATUS.UNVERIFIED,
    calculated_status: null,
    override: null,
  };

  if (calculation?.id) {
    overrides = await getCapacityOverrides(supabase, calculation.id);
    effective = await getEffectiveCapacityStatus(supabase, calculation);
  }

  return {
    calculation,
    passengers: passengersResult.data || [],
    boat_capacity_profile: profile,
    boat: boat || null,
    booking: bookingRow.data || null,
    overrides,
    effective_status: effective.status,
    calculated_status: effective.calculated_status || calculation?.status || null,
    latest_override: effective.override,
  };
}

module.exports = {
  loadCapacityProfile,
  loadBookingForCapacity,
  tripContextFromBooking,
  tripContextFromTripType,
  resolveBoatIdForTripType,
  replacePassengers,
  saveCapacityCalculation,
  getLatestCapacityCalculation,
  runCapacityCore,
  runCapacityCheckForBooking,
  runCapacityCheckForTripType,
  attachCapacityFieldsToPublicBooking,
  evaluateCapacityApprovalGate,
  getCapacityOverrides,
  getEffectiveCapacityStatus,
  recalculateCapacityFromManifest,
  applyCapacityOverride,
  getCapacityDetailForBooking,
};
