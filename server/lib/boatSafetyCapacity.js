/**
 * Boat safety capacity calculator — pure functions, decimal-safe (2 dp).
 * Uses verified admin-entered plate limits only; never guesses capacity.
 */

const CAPACITY_STATUS = {
  WITHIN: 'within_operating_range',
  REVIEW: 'captain_review_required',
  EXCEEDED: 'capacity_exceeded',
  UNVERIFIED: 'capacity_unverified',
};

const THRESHOLD_BAND = {
  GREEN: 'green',
  YELLOW: 'yellow',
  RED: 'red',
};

/** Weights above this flag captain review (not a rejection). */
const HEAVY_PASSENGER_REVIEW_LBS = 350;

const PUBLIC_MESSAGES = {
  [CAPACITY_STATUS.WITHIN]:
    'Based on the information entered, this passenger group is currently within the operating limits for the selected boat. Final approval remains subject to captain review, weather, equipment, and actual conditions.',
  [CAPACITY_STATUS.REVIEW]:
    'The captain must review this passenger group before departure. Your reservation has not been cancelled.',
  [CAPACITY_STATUS.EXCEEDED]:
    'This passenger group exceeds the current operating limit for the selected boat. Please contact Launch Zone Charters so we can review available options.',
  [CAPACITY_STATUS.UNVERIFIED]:
    'Capacity information for this boat has not been verified yet. Please contact Launch Zone Charters for assistance.',
};

const PASSENGER_TYPES = new Set(['adult', 'child', 'infant']);

function roundLbs(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function parseWeightLbs(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    return { valid: false, error: 'invalid_weight' };
  }
  return { valid: true, lbs: roundLbs(n) };
}

function normalizePassengerType(raw) {
  const v = String(raw || '')
    .trim()
    .toLowerCase();
  return PASSENGER_TYPES.has(v) ? v : null;
}

function lifeJacketNeedsReview(size) {
  const s = String(size || '').trim().toLowerCase();
  return s.includes('unsure');
}

function isCaptainLedTrip(tripContext = {}) {
  if (tripContext.captainIncluded === true) return true;
  const bookingType = String(tripContext.bookingType || '').trim().toLowerCase();
  if (bookingType === 'charter') return true;
  if (String(tripContext.charterType || '').trim().toLowerCase() === 'captain_charter') return true;
  return false;
}

/**
 * @param {object|null} profile Row from boat_capacity_profiles
 */
function buildOperationalLimits(profile) {
  if (!profile || profile.capacity_verified !== true) {
    return { verified: false };
  }

  const maxPersons = profile.maximum_persons != null ? Math.floor(Number(profile.maximum_persons)) : null;
  const maxPersonsWeight = roundLbs(profile.maximum_persons_weight_lbs);
  const maxTotalLoad = roundLbs(profile.maximum_total_load_lbs);
  const safetyBuffer = roundLbs(profile.safety_buffer_lbs || 0);
  const operatorWeight = roundLbs(profile.operator_weight_lbs || 0);

  if (
    maxPersons == null ||
    maxPersons <= 0 ||
    maxPersonsWeight <= 0 ||
    maxTotalLoad <= 0 ||
    operatorWeight <= 0
  ) {
    return { verified: false };
  }

  const operationalTotalLoadLimit = roundLbs(Math.max(0, maxTotalLoad - safetyBuffer));
  const operationalPersonsWeightLimit = roundLbs(Math.max(0, maxPersonsWeight - safetyBuffer));

  if (operationalTotalLoadLimit <= 0 || operationalPersonsWeightLimit <= 0) {
    return { verified: false };
  }

  return {
    verified: true,
    maxPersons,
    maxPersonsWeight,
    maxTotalLoad,
    operationalTotalLoadLimit,
    operationalPersonsWeightLimit,
    operatorWeight,
    standardEquipmentWeight: roundLbs(profile.standard_equipment_weight_lbs || 0),
    fuelAllowanceWeight: roundLbs(profile.fuel_allowance_weight_lbs || 0),
    warningThresholdPercent: roundLbs(profile.warning_threshold_percent || 85),
    configVersion: Math.floor(Number(profile.config_version) || 1),
  };
}

/**
 * Validate passenger manifest input.
 * @returns {{ valid: boolean, errors: string[], passengers: object[] }}
 */
function validatePassengers(passengers, expectedCount) {
  const errors = [];
  const list = Array.isArray(passengers) ? passengers : [];

  if (expectedCount != null) {
    const expected = Math.floor(Number(expectedCount));
    if (!Number.isFinite(expected) || expected < 1) {
      errors.push('invalid_passenger_count');
    } else if (list.length !== expected) {
      errors.push('passenger_count_mismatch');
    }
  }

  if (list.length === 0) {
    errors.push('no_passengers');
  }

  const normalized = [];
  for (let i = 0; i < list.length; i += 1) {
    const row = list[i] || {};
    const weight = parseWeightLbs(row.weight_lbs ?? row.weightLbs ?? row.weight);
    if (!weight.valid) {
      errors.push(`passenger_${i + 1}_invalid_weight`);
      continue;
    }

    const passengerType = normalizePassengerType(row.passenger_type ?? row.passengerType ?? row.type);
    if (!passengerType) {
      errors.push(`passenger_${i + 1}_invalid_type`);
    }

    const name = String(row.passenger_name ?? row.passengerName ?? row.name ?? '').trim();
    if (!name) {
      errors.push(`passenger_${i + 1}_missing_name`);
    }

    normalized.push({
      passenger_number: i + 1,
      passenger_name: name || `Passenger ${i + 1}`,
      passenger_type: passengerType || 'adult',
      weight_lbs: weight.lbs,
      life_jacket_size: String(row.life_jacket_size ?? row.lifeJacketSize ?? '').trim() || null,
      mobility_assistance_required: Boolean(
        row.mobility_assistance_required ?? row.mobilityAssistanceRequired ?? row.mobilityRequired
      ),
      mobility_notes: String(row.mobility_notes ?? row.mobilityNotes ?? '').trim() || null,
    });
  }

  return { valid: errors.length === 0, errors, passengers: normalized };
}

function normalizeLoadInput(load = {}) {
  const cooler = roundLbs(load.cooler_weight_lbs ?? load.coolerWeightLbs ?? load.coolerWeight ?? 0);
  const personal = roundLbs(
    load.personal_gear_weight_lbs ?? load.personalGearWeightLbs ?? load.personalGearWeight ?? 0
  );
  const other = roundLbs(
    load.other_equipment_weight_lbs ?? load.otherEquipmentWeightLbs ?? load.otherEquipmentWeight ?? 0
  );
  const description = String(
    load.other_equipment_description ?? load.otherEquipmentDescription ?? ''
  ).trim();

  return {
    cooler_weight_lbs: cooler >= 0 ? cooler : 0,
    personal_gear_weight_lbs: personal >= 0 ? personal : 0,
    other_equipment_weight_lbs: other >= 0 ? other : 0,
    other_equipment_description: description || null,
    customer_gear_total_lbs: roundLbs(Math.max(0, cooler) + Math.max(0, personal) + Math.max(0, other)),
  };
}

function utilizationPercent(actual, limit) {
  if (!Number.isFinite(limit) || limit <= 0) return 0;
  return roundLbs((actual / limit) * 100);
}

function thresholdBandForPercent(percent, warningThresholdPercent) {
  if (percent > 100) return THRESHOLD_BAND.RED;
  if (percent >= warningThresholdPercent) return THRESHOLD_BAND.YELLOW;
  return THRESHOLD_BAND.GREEN;
}

/**
 * Core capacity calculation.
 * @param {object} params
 * @param {object|null} params.profile boat_capacity_profiles row
 * @param {object[]} params.passengers normalized passengers
 * @param {object} [params.load] gear weights
 * @param {object} [params.tripContext] captainIncluded, bookingType, charterType
 */
function calculateBoatSafetyCapacity({ profile, passengers, load, tripContext }) {
  const limits = buildOperationalLimits(profile);
  const gear = normalizeLoadInput(load);
  const captainLed = isCaptainLedTrip(tripContext);

  const passengerWeightTotal = roundLbs(
    (passengers || []).reduce((sum, p) => sum + roundLbs(p.weight_lbs), 0)
  );
  const operatorWeight = limits.verified ? limits.operatorWeight : 0;
  const personsWeight = roundLbs(passengerWeightTotal + (captainLed ? operatorWeight : 0));
  const totalPersonsAboard = (passengers || []).length + (captainLed ? 1 : 0);

  const estimatedOperatingLoad = limits.verified
    ? roundLbs(
        personsWeight +
          limits.standardEquipmentWeight +
          limits.fuelAllowanceWeight +
          gear.customer_gear_total_lbs
      )
    : 0;

  const reviewFlags = [];

  for (const p of passengers || []) {
    if (p.mobility_assistance_required) reviewFlags.push('mobility_assistance');
    if (lifeJacketNeedsReview(p.life_jacket_size)) reviewFlags.push('life_jacket_unsure');
    if (p.weight_lbs >= HEAVY_PASSENGER_REVIEW_LBS) reviewFlags.push('heavy_passenger_review');
  }
  if (gear.other_equipment_description) reviewFlags.push('unusual_equipment_described');
  if (gear.other_equipment_weight_lbs > 0 && gear.other_equipment_description) {
    reviewFlags.push('other_equipment_weight');
  }

  if (!limits.verified) {
    return {
      status: CAPACITY_STATUS.UNVERIFIED,
      threshold_band: null,
      message: PUBLIC_MESSAGES[CAPACITY_STATUS.UNVERIFIED],
      canProceed: false,
      requiresStaffReview: true,
      limits,
      totals: {
        passenger_count: (passengers || []).length,
        total_persons_aboard: totalPersonsAboard,
        passenger_weight_total_lbs: passengerWeightTotal,
        operator_weight_lbs: captainLed ? operatorWeight : 0,
        persons_weight_lbs: personsWeight,
        cooler_weight_lbs: gear.cooler_weight_lbs,
        personal_gear_weight_lbs: gear.personal_gear_weight_lbs,
        other_equipment_weight_lbs: gear.other_equipment_weight_lbs,
        other_equipment_description: gear.other_equipment_description,
        customer_gear_total_lbs: gear.customer_gear_total_lbs,
        estimated_operating_load_lbs: estimatedOperatingLoad,
        operational_weight_limit_lbs: null,
        remaining_margin_lbs: null,
        capacity_percent: null,
      },
      review_flags: reviewFlags,
      config_version: profile?.config_version ?? null,
    };
  }

  const loadUtil = utilizationPercent(estimatedOperatingLoad, limits.operationalTotalLoadLimit);
  const personsWeightUtil = utilizationPercent(personsWeight, limits.operationalPersonsWeightLimit);

  const capacityPercent = Math.max(loadUtil, personsWeightUtil);

  const exceedsPersons = totalPersonsAboard > limits.maxPersons;
  const exceedsPersonsWeight = personsWeight > limits.operationalPersonsWeightLimit;
  const exceedsOperatingLoad = estimatedOperatingLoad > limits.operationalTotalLoadLimit;

  const remainingMargin = roundLbs(limits.operationalTotalLoadLimit - estimatedOperatingLoad);
  const thresholdBand = thresholdBandForPercent(capacityPercent, limits.warningThresholdPercent);

  let status = CAPACITY_STATUS.WITHIN;
  if (exceedsPersons || exceedsPersonsWeight || exceedsOperatingLoad) {
    status = CAPACITY_STATUS.EXCEEDED;
  } else if (
    reviewFlags.length > 0 ||
    thresholdBand === THRESHOLD_BAND.YELLOW ||
    capacityPercent >= limits.warningThresholdPercent
  ) {
    status = CAPACITY_STATUS.REVIEW;
  }

  return {
    status,
    threshold_band: exceedsPersons || exceedsPersonsWeight || exceedsOperatingLoad ? THRESHOLD_BAND.RED : thresholdBand,
    message: PUBLIC_MESSAGES[status],
    canProceed: status !== CAPACITY_STATUS.EXCEEDED && status !== CAPACITY_STATUS.UNVERIFIED,
    requiresStaffReview: status === CAPACITY_STATUS.REVIEW || status === CAPACITY_STATUS.UNVERIFIED,
    limits,
    totals: {
      passenger_count: (passengers || []).length,
      total_persons_aboard: totalPersonsAboard,
      passenger_weight_total_lbs: passengerWeightTotal,
      operator_weight_lbs: captainLed ? operatorWeight : 0,
      persons_weight_lbs: personsWeight,
      cooler_weight_lbs: gear.cooler_weight_lbs,
      personal_gear_weight_lbs: gear.personal_gear_weight_lbs,
      other_equipment_weight_lbs: gear.other_equipment_weight_lbs,
      other_equipment_description: gear.other_equipment_description,
      customer_gear_total_lbs: gear.customer_gear_total_lbs,
      estimated_operating_load_lbs: estimatedOperatingLoad,
      operational_weight_limit_lbs: limits.operationalTotalLoadLimit,
      remaining_margin_lbs: remainingMargin,
      capacity_percent: capacityPercent,
      load_utilization_percent: loadUtil,
      persons_weight_utilization_percent: personsWeightUtil,
    },
    review_flags: reviewFlags,
    config_version: limits.configVersion,
  };
}

/** Public API payload — omits per-passenger weights. */
function toPublicCapacityResult(result) {
  return {
    status: result.status,
    threshold_band: result.threshold_band,
    message: result.message,
    canProceed: result.canProceed,
    requiresStaffReview: result.requiresStaffReview,
    passenger_count: result.totals.passenger_count,
    total_persons_aboard: result.totals.total_persons_aboard,
    capacity_verified: result.limits?.verified === true,
    has_mobility_concerns: (result.review_flags || []).includes('mobility_assistance'),
    has_life_jacket_concerns: (result.review_flags || []).includes('life_jacket_unsure'),
  };
}

module.exports = {
  CAPACITY_STATUS,
  THRESHOLD_BAND,
  HEAVY_PASSENGER_REVIEW_LBS,
  PUBLIC_MESSAGES,
  roundLbs,
  parseWeightLbs,
  buildOperationalLimits,
  validatePassengers,
  normalizeLoadInput,
  isCaptainLedTrip,
  calculateBoatSafetyCapacity,
  toPublicCapacityResult,
};
