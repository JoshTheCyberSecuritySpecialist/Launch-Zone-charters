const assert = require('node:assert/strict');
const test = require('node:test');
const {
  MAX_GUEST_WEIGHT_LBS,
  MAX_CAPTAIN_LED_GUESTS,
  validateWaiverPassengers,
  totalGuestWeightLbs,
} = require('../lib/waiverPassengerLimits');

function passengersFromWeights(weights) {
  return weights.map((weight_lbs, index) => ({
    passenger_name: `Guest ${index + 1}`,
    passenger_type: 'adult',
    weight_lbs,
    life_jacket_size: 'Adult medium',
  }));
}

test('accepts five guests totaling exactly 745 lbs', () => {
  const result = validateWaiverPassengers(passengersFromWeights([149, 149, 149, 149, 149]), 5, {
    tripType: 'pontoon_rental',
  });
  assert.equal(result.ok, true);
  assert.equal(result.totalGuestWeight, MAX_GUEST_WEIGHT_LBS);
});

test('rejects five guests totaling 746 lbs', () => {
  const result = validateWaiverPassengers(passengersFromWeights([149.2, 149.2, 149.2, 149.2, 149.2]), 5);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PASSENGER_WEIGHT_LIMIT_EXCEEDED');
  assert.equal(result.totalGuestWeight, 746);
  assert.equal(result.maximumGuestWeight, MAX_GUEST_WEIGHT_LBS);
});

test('accepts under-limit guests with no boat context', () => {
  const result = validateWaiverPassengers(passengersFromWeights([180, 200]), 2, {
    tripType: 'pontoon_rental',
  });
  assert.equal(result.ok, true);
  assert.equal(result.totalGuestWeight, 380);
});

test('rejects six guests on captain-led trip', () => {
  const result = validateWaiverPassengers(
    passengersFromWeights([100, 100, 100, 100, 100, 100]),
    6,
    { tripType: 'captain_charter' }
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PASSENGER_COUNT_LIMIT_EXCEEDED');
  assert.equal(result.guestCount, 6);
  assert.equal(result.maximumGuests, MAX_CAPTAIN_LED_GUESTS);
});

test('rejects missing passenger weight', () => {
  const result = validateWaiverPassengers(
    [{ passenger_name: 'Alex', passenger_type: 'adult', weight_lbs: '', life_jacket_size: 'Adult medium' }],
    1
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, 'INVALID_PASSENGER_DATA');
});

test('accepts numeric string weights when valid', () => {
  const result = validateWaiverPassengers(
    [{ passenger_name: 'Alex', passenger_type: 'adult', weight_lbs: '180', life_jacket_size: 'Adult medium' }],
    1
  );
  assert.equal(result.ok, true);
  assert.equal(totalGuestWeightLbs(result.passengers), 180);
});

test('rejects negative, zero, NaN, and unrealistic weights', () => {
  for (const weight of [-5, 0, 'abc', 600]) {
    const result = validateWaiverPassengers(
      [{ passenger_name: 'Alex', passenger_type: 'adult', weight_lbs: weight, life_jacket_size: 'Adult medium' }],
      1
    );
    assert.equal(result.ok, false, `expected reject for weight ${weight}`);
  }
});

test('accepts five captain-led guests under weight limit', () => {
  const result = validateWaiverPassengers(passengersFromWeights([140, 140, 140, 140, 140]), 5, {
    captainLed: true,
  });
  assert.equal(result.ok, true);
});

test('runWaiverPassengerCheck persists without boat id', async () => {
  const { runWaiverPassengerCheck } = require('../services/waiverPassengerService');
  const inserts = [];
  const supabase = {
    from(table) {
      const chain = {
        delete() {
          return { eq: async () => ({ error: null }) };
        },
        insert(row) {
          inserts.push({ table, row });
          return {
            select() {
              return { maybeSingle: async () => ({ data: { id: 'calc-1' }, error: null }) };
            },
          };
        },
        eq() {
          return chain;
        },
      };
      return chain;
    },
  };

  const run = await runWaiverPassengerCheck(supabase, {
    preTripSubmissionId: 'pretrip-1',
    passengers: passengersFromWeights([200, 200]),
    expectedPassengerCount: 2,
    load: { cooler_weight_lbs: 20 },
    tripContext: { tripType: 'pontoon_rental' },
    customerConfirmed: true,
    persist: true,
  });

  assert.equal(run.result.canProceed, true);
  assert.ok(inserts.some((entry) => entry.table === 'booking_passengers'));
  const snapshot = inserts.find((entry) => entry.table === 'booking_capacity_calculations');
  assert.ok(snapshot);
  assert.equal(snapshot.row.boat_id, null);
});
