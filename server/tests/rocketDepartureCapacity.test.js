'use strict';

const assert = require('assert');
const { evaluateSharedCharterCapacity } = require('../lib/sharedCharterCapacity');
const { getRocketLaunchPackage, ROCKET_LAUNCH_MIN_GUESTS } = require('../config/rocketLaunchPackages');
const {
  buildRocketDepartureSummary,
  computeDepartureStatusFromGuestTotal,
  sumRocketDepartureGuestTotal,
  capacitySeatsForRow,
  DEPARTURE_STATUS,
} = require('../services/rocketDepartureService');

function rocketRow(partial) {
  return {
    id: partial.id,
    status: partial.status || 'confirmed',
    booking_type: 'charter',
    charter_type: 'rocket',
    charter_seating: partial.charter_seating || 'shared',
    boat_id: 'boat-1',
    guest_count: partial.guest_count,
    pricing_package_id: partial.pricing_package_id,
    start_time: partial.start_time || '2026-08-28T00:00:00.000Z',
    end_time: partial.end_time || '2026-08-28T01:00:00.000Z',
    expires_at: null,
  };
}

function runMinimumStatusTests() {
  assert.strictEqual(computeDepartureStatusFromGuestTotal(1), DEPARTURE_STATUS.AWAITING_MINIMUM);
  assert.strictEqual(computeDepartureStatusFromGuestTotal(3), DEPARTURE_STATUS.AWAITING_MINIMUM);
  assert.strictEqual(computeDepartureStatusFromGuestTotal(4), DEPARTURE_STATUS.DEPARTURE_CONFIRMED);
  assert.strictEqual(computeDepartureStatusFromGuestTotal(5), DEPARTURE_STATUS.DEPARTURE_FULL);
  assert.strictEqual(ROCKET_LAUNCH_MIN_GUESTS, 4);
}

function runDepartureSummaryTests() {
  const below = buildRocketDepartureSummary(2);
  assert.strictEqual(below.guestsBooked, 2);
  assert.strictEqual(below.guestsNeededForMinimum, 2);
  assert.strictEqual(below.minimumReached, false);

  const atMin = buildRocketDepartureSummary(4);
  assert.strictEqual(atMin.minimumReached, true);
  assert.strictEqual(atMin.seatsRemaining, 1);
}

function runCapacityReservedTests() {
  const solo = rocketRow({ id: 'a', pricing_package_id: 'rocket_solo', guest_count: 1 });
  const duo = rocketRow({ id: 'b', pricing_package_id: 'rocket_duo', guest_count: 2 });
  assert.strictEqual(capacitySeatsForRow(solo), 1);
  assert.strictEqual(capacitySeatsForRow(duo), 2);

  const total = sumRocketDepartureGuestTotal([solo, duo]);
  assert.strictEqual(total, 3);
  assert.strictEqual(computeDepartureStatusFromGuestTotal(total), DEPARTURE_STATUS.AWAITING_MINIMUM);
}

function runSharedCapacityCombinationTests() {
  const start = '2026-08-28T00:00:00.000Z';
  const end = '2026-08-28T01:00:00.000Z';
  const row = (id, packageId, guestCount) =>
    rocketRow({
      id,
      pricing_package_id: packageId,
      guest_count: guestCount,
      start_time: start,
      end_time: end,
    });

  const solo = getRocketLaunchPackage('rocket_solo').guestCount;
  const duo = getRocketLaunchPackage('rocket_duo').guestCount;

  let result = evaluateSharedCharterCapacity({
    overlappingBookings: [row('a', 'rocket_solo', solo), row('b', 'rocket_solo', solo)],
    proposedGuestCount: duo,
  });
  assert.strictEqual(result.available, true, 'solo+solo accepts duo');

  result = evaluateSharedCharterCapacity({
    overlappingBookings: [
      row('a', 'rocket_solo', solo),
      row('b', 'rocket_duo', duo),
      row('c', 'rocket_solo', solo),
      row('d', 'rocket_solo', solo),
    ],
    proposedGuestCount: solo,
  });
  assert.strictEqual(result.available, false, 'full departure rejects another solo');

  result = evaluateSharedCharterCapacity({
    overlappingBookings: [],
    proposedGuestCount: duo,
  });
  assert.strictEqual(result.available, true, 'empty slot accepts duo');
}

function runPrivateExclusiveTests() {
  const start = '2026-08-28T00:00:00.000Z';
  const end = '2026-08-28T01:00:00.000Z';
  const privateRow = rocketRow({
    id: 'p1',
    pricing_package_id: 'rocket_private',
    charter_seating: 'private',
    guest_count: 2,
    start_time: start,
    end_time: end,
  });

  const result = evaluateSharedCharterCapacity({
    overlappingBookings: [privateRow],
    proposedGuestCount: 1,
  });
  assert.strictEqual(result.available, false);
  assert.strictEqual(result.reason, 'exclusive_conflict');
}

function run() {
  runMinimumStatusTests();
  runDepartureSummaryTests();
  runCapacityReservedTests();
  runSharedCapacityCombinationTests();
  runPrivateExclusiveTests();
  console.log('rocketDepartureCapacity.test.js: all tests passed');
}

run();
