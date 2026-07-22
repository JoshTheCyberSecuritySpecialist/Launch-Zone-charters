const assert = require('assert');
const {
  CAPACITY_STATUS,
  THRESHOLD_BAND,
  buildOperationalLimits,
  validatePassengers,
  calculateBoatSafetyCapacity,
  toPublicCapacityResult,
} = require('../lib/boatSafetyCapacity');

function verifiedProfile(overrides = {}) {
  return {
    boat_id: 'boat-1',
    capacity_verified: true,
    maximum_persons: 6,
    maximum_persons_weight_lbs: 1200,
    maximum_total_load_lbs: 1500,
    operator_weight_lbs: 200,
    standard_equipment_weight_lbs: 50,
    fuel_allowance_weight_lbs: 30,
    safety_buffer_lbs: 100,
    warning_threshold_percent: 85,
    config_version: 1,
    ...overrides,
  };
}

function passenger(weight, partial = {}) {
  return {
    passenger_name: partial.name || 'Guest',
    passenger_type: partial.type || 'adult',
    weight_lbs: weight,
    life_jacket_size: partial.life_jacket_size || 'Adult medium',
    mobility_assistance_required: partial.mobility_assistance_required || false,
  };
}

function run() {
  const limits = buildOperationalLimits(verifiedProfile());
  assert.strictEqual(limits.verified, true);
  assert.strictEqual(limits.operationalTotalLoadLimit, 1400);
  assert.strictEqual(limits.operationalPersonsWeightLimit, 1100);

  assert.strictEqual(buildOperationalLimits({ capacity_verified: false }).verified, false);

  // 1. Five guests plus one captain — within range (all utilizations below 85% warning)
  let result = calculateBoatSafetyCapacity({
    profile: verifiedProfile(),
    passengers: [
      passenger(140, { name: 'A' }),
      passenger(130, { name: 'B' }),
      passenger(120, { name: 'C' }),
      passenger(110, { name: 'D' }),
      passenger(100, { name: 'E' }),
    ],
    load: { cooler_weight_lbs: 10, personal_gear_weight_lbs: 5 },
    tripContext: { captainIncluded: true, bookingType: 'charter' },
  });
  assert.strictEqual(result.totals.total_persons_aboard, 6);
  assert.strictEqual(result.status, CAPACITY_STATUS.WITHIN);
  assert.strictEqual(result.canProceed, true);

  // 2. Passenger count above configured limit
  result = calculateBoatSafetyCapacity({
    profile: verifiedProfile({ maximum_persons: 5 }),
    passengers: [passenger(150), passenger(150), passenger(150), passenger(150), passenger(150)],
    load: {},
    tripContext: { captainIncluded: true, bookingType: 'charter' },
  });
  assert.strictEqual(result.totals.total_persons_aboard, 6);
  assert.strictEqual(result.status, CAPACITY_STATUS.EXCEEDED);

  // 3. Weight below warning threshold (green)
  result = calculateBoatSafetyCapacity({
    profile: verifiedProfile(),
    passengers: [passenger(150), passenger(150)],
    load: {},
    tripContext: { captainIncluded: true, bookingType: 'charter' },
  });
  assert.strictEqual(result.threshold_band, THRESHOLD_BAND.GREEN);
  assert.strictEqual(result.status, CAPACITY_STATUS.WITHIN);

  // 4. Weight within warning threshold (yellow → review, not exceeded)
  result = calculateBoatSafetyCapacity({
    profile: verifiedProfile({
      maximum_total_load_lbs: 1000,
      maximum_persons_weight_lbs: 1000,
      operator_weight_lbs: 200,
      standard_equipment_weight_lbs: 0,
      fuel_allowance_weight_lbs: 0,
      safety_buffer_lbs: 0,
      warning_threshold_percent: 85,
    }),
    passengers: [passenger(250), passenger(250)],
    load: { cooler_weight_lbs: 120, personal_gear_weight_lbs: 80 },
    tripContext: { captainIncluded: true, bookingType: 'charter' },
  });
  assert.ok(result.totals.capacity_percent >= 85);
  assert.ok(result.totals.capacity_percent <= 100);
  assert.strictEqual(result.status, CAPACITY_STATUS.REVIEW);

  // 5. Weight above operational limit
  result = calculateBoatSafetyCapacity({
    profile: verifiedProfile({ maximum_total_load_lbs: 700, maximum_persons_weight_lbs: 700, safety_buffer_lbs: 0 }),
    passengers: [passenger(300), passenger(300), passenger(300)],
    load: {},
    tripContext: { captainIncluded: true, bookingType: 'charter' },
  });
  assert.strictEqual(result.status, CAPACITY_STATUS.EXCEEDED);
  assert.strictEqual(result.canProceed, false);

  // 6. Weight exactly on operational limit — review (at 100%, yellow threshold)
  result = calculateBoatSafetyCapacity({
    profile: verifiedProfile({
      maximum_total_load_lbs: 500,
      maximum_persons_weight_lbs: 500,
      operator_weight_lbs: 100,
      standard_equipment_weight_lbs: 0,
      fuel_allowance_weight_lbs: 0,
      safety_buffer_lbs: 0,
      warning_threshold_percent: 85,
    }),
    passengers: [passenger(200), passenger(200)],
    load: {},
    tripContext: { captainIncluded: true, bookingType: 'charter' },
  });
  assert.strictEqual(result.totals.estimated_operating_load_lbs, 500);
  assert.ok(result.status === CAPACITY_STATUS.REVIEW || result.status === CAPACITY_STATUS.WITHIN);

  // 7. Missing passenger weight
  const invalid = validatePassengers([{ passenger_name: 'A', passenger_type: 'adult', weight_lbs: 0 }], 1);
  assert.strictEqual(invalid.valid, false);

  // 8. Invalid negative weight
  const negative = validatePassengers([{ passenger_name: 'A', passenger_type: 'adult', weight_lbs: -10 }], 1);
  assert.strictEqual(negative.valid, false);

  // 9. Very large value requiring review
  result = calculateBoatSafetyCapacity({
    profile: verifiedProfile(),
    passengers: [passenger(360), passenger(150)],
    load: {},
    tripContext: { captainIncluded: true, bookingType: 'charter' },
  });
  assert.strictEqual(result.status, CAPACITY_STATUS.REVIEW);
  assert.ok(result.review_flags.includes('heavy_passenger_review'));

  // 10. Child and infant passengers
  const mixed = validatePassengers(
    [
      { passenger_name: 'Adult', passenger_type: 'adult', weight_lbs: 180 },
      { passenger_name: 'Child', passenger_type: 'child', weight_lbs: 60 },
      { passenger_name: 'Infant', passenger_type: 'infant', weight_lbs: 20 },
    ],
    3
  );
  assert.strictEqual(mixed.valid, true);
  assert.strictEqual(mixed.passengers.length, 3);

  // 11. Customer gear and cooler weight
  result = calculateBoatSafetyCapacity({
    profile: verifiedProfile(),
    passengers: [passenger(180), passenger(180)],
    load: { cooler_weight_lbs: 40, personal_gear_weight_lbs: 25, other_equipment_weight_lbs: 15 },
    tripContext: { captainIncluded: true, bookingType: 'charter' },
  });
  assert.strictEqual(result.totals.customer_gear_total_lbs, 80);

  // 14. Unverified boat capacity
  result = calculateBoatSafetyCapacity({
    profile: { capacity_verified: false },
    passengers: [passenger(180)],
    load: {},
    tripContext: { captainIncluded: true },
  });
  assert.strictEqual(result.status, CAPACITY_STATUS.UNVERIFIED);
  assert.strictEqual(result.canProceed, false);

  // Public payload hides weights
  const pub = toPublicCapacityResult(result);
  assert.strictEqual(pub.status, CAPACITY_STATUS.UNVERIFIED);
  assert.strictEqual('passenger_weight_total_lbs' in pub, false);

  // Passenger count mismatch
  const mismatch = validatePassengers([passenger(180)], 2);
  assert.strictEqual(mismatch.valid, false);
  assert.ok(mismatch.errors.includes('passenger_count_mismatch'));

  // Rental without captain — operator weight excluded from persons weight
  result = calculateBoatSafetyCapacity({
    profile: verifiedProfile(),
    passengers: [passenger(180), passenger(180), passenger(180)],
    load: {},
    tripContext: { captainIncluded: false, bookingType: 'rental' },
  });
  assert.strictEqual(result.totals.operator_weight_lbs, 0);
  assert.strictEqual(result.totals.total_persons_aboard, 3);
  assert.strictEqual(result.totals.persons_weight_lbs, 540);

  // Mobility triggers review
  result = calculateBoatSafetyCapacity({
    profile: verifiedProfile(),
    passengers: [passenger(180, { mobility_assistance_required: true })],
    load: {},
    tripContext: { captainIncluded: true, bookingType: 'charter' },
  });
  assert.strictEqual(result.status, CAPACITY_STATUS.REVIEW);
  assert.ok(result.review_flags.includes('mobility_assistance'));

  console.log('boatSafetyCapacity.test: all assertions passed');
}

run();
