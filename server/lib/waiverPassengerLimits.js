const boatSafetyCapacity = require('./boatSafetyCapacity');

const MAX_GUEST_WEIGHT_LBS = 745;
const MAX_CAPTAIN_LED_GUESTS = 5;
/** Single-passenger weight above this is rejected as unrealistic. */
const MAX_SINGLE_PASSENGER_WEIGHT_LBS = 500;

const ERROR_CODES = {
  WEIGHT_LIMIT: 'PASSENGER_WEIGHT_LIMIT_EXCEEDED',
  COUNT_LIMIT: 'PASSENGER_COUNT_LIMIT_EXCEEDED',
  INVALID_PASSENGER: 'INVALID_PASSENGER_DATA',
};

const MESSAGES = {
  weightExceeded:
    'The combined passenger weight is above the 745 lb safety limit. Please contact Launch Zone Charters so we can safely review your trip.',
  countExceeded:
    'Captain-led trips are limited to 5 guests because the vessel carries 6 people total, including the captain.',
  saved:
    'Passenger information saved. You may continue with your waiver and documents.',
};

function roundLbs(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function totalGuestWeightLbs(passengers) {
  return roundLbs(
    (passengers || []).reduce((total, passenger) => total + Number(passenger.weight_lbs || 0), 0)
  );
}

function isCaptainLedTrip(context = {}) {
  if (context.captainLed === true || context.captainIncluded === true) return true;
  const tripType = String(context.tripType || context.trip_type || '').trim();
  if (tripType === 'captain_charter') return true;
  return boatSafetyCapacity.isCaptainLedTrip(context);
}

/**
 * Validate waiver / pre-trip passenger manifest against fixed 745 lb guest-weight limit.
 */
function validateWaiverPassengers(passengers, expectedCount, context = {}) {
  const manifest = boatSafetyCapacity.validatePassengers(passengers, expectedCount);
  if (!manifest.valid) {
    return {
      ok: false,
      success: false,
      code: ERROR_CODES.INVALID_PASSENGER,
      message: 'Passenger information is incomplete or invalid. Check each name and weight.',
      errors: manifest.errors,
    };
  }

  for (let i = 0; i < manifest.passengers.length; i += 1) {
    const weight = Number(manifest.passengers[i].weight_lbs);
    if (weight > MAX_SINGLE_PASSENGER_WEIGHT_LBS) {
      return {
        ok: false,
        success: false,
        code: ERROR_CODES.INVALID_PASSENGER,
        message: `Passenger ${i + 1} weight exceeds the allowed entry range.`,
        errors: [`passenger_${i + 1}_unrealistic_weight`],
      };
    }
  }

  const guestCount = manifest.passengers.length;
  const totalGuestWeight = totalGuestWeightLbs(manifest.passengers);
  const captainLed = isCaptainLedTrip(context);

  if (captainLed && guestCount > MAX_CAPTAIN_LED_GUESTS) {
    return {
      ok: false,
      success: false,
      code: ERROR_CODES.COUNT_LIMIT,
      message: MESSAGES.countExceeded,
      guestCount,
      maximumGuests: MAX_CAPTAIN_LED_GUESTS,
    };
  }

  if (totalGuestWeight > MAX_GUEST_WEIGHT_LBS) {
    return {
      ok: false,
      success: false,
      code: ERROR_CODES.WEIGHT_LIMIT,
      message: MESSAGES.weightExceeded,
      totalGuestWeight,
      maximumGuestWeight: MAX_GUEST_WEIGHT_LBS,
    };
  }

  return {
    ok: true,
    success: true,
    passengers: manifest.passengers,
    guestCount,
    totalGuestWeight,
    remainingGuestWeight: roundLbs(Math.max(0, MAX_GUEST_WEIGHT_LBS - totalGuestWeight)),
    maximumGuestWeight: MAX_GUEST_WEIGHT_LBS,
    captainLed,
  };
}

function toPublicWaiverPassengerResult(validation, extras = {}) {
  const mobility = (validation.passengers || []).some((p) => p.mobility_assistance_required);
  const lifeJacketReview = (validation.passengers || []).some((p) =>
    String(p.life_jacket_size || '')
      .toLowerCase()
      .includes('unsure')
  );

  return {
    success: validation.ok,
    status: validation.ok ? 'within_operating_range' : 'capacity_exceeded',
    threshold_band: validation.ok ? 'green' : 'red',
    message: validation.ok ? MESSAGES.saved : validation.message,
    canProceed: validation.ok,
    requiresStaffReview: false,
    passenger_count: validation.guestCount ?? 0,
    total_persons_aboard: validation.guestCount ?? 0,
    total_guest_weight_lbs: validation.totalGuestWeight ?? 0,
    remaining_guest_weight_lbs: validation.remainingGuestWeight ?? MAX_GUEST_WEIGHT_LBS,
    maximum_guest_weight_lbs: MAX_GUEST_WEIGHT_LBS,
    capacity_verified: true,
    has_mobility_concerns: mobility,
    has_life_jacket_concerns: lifeJacketReview,
    code: validation.code || null,
    guestCount: validation.guestCount,
    maximumGuests: validation.maximumGuests,
    totalGuestWeight: validation.totalGuestWeight,
    maximumGuestWeight: validation.maximumGuestWeight,
    calculation_id: extras.calculationId || null,
  };
}

module.exports = {
  MAX_GUEST_WEIGHT_LBS,
  MAX_CAPTAIN_LED_GUESTS,
  MAX_SINGLE_PASSENGER_WEIGHT_LBS,
  ERROR_CODES,
  MESSAGES,
  totalGuestWeightLbs,
  isCaptainLedTrip,
  validateWaiverPassengers,
  toPublicWaiverPassengerResult,
};
