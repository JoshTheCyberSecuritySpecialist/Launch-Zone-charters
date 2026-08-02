'use strict';

/**
 * Mixed package seat math uses guest_count on overlapping charter rows only (captain excluded).
 * Uses sharedCharterCapacity — same path as availability for direct/staff bio bookings.
 */

const assert = require('assert');
const { DateTime } = require('luxon');
const { evaluateSharedCharterCapacity } = require('../lib/sharedCharterCapacity');
const { getBioluminescencePackage } = require('../config/bioluminescencePackages');

const GUESTS = {
  solo: getBioluminescencePackage('bio_solo').guestCount,
  two: getBioluminescencePackage('bio_two').guestCount,
  four: getBioluminescencePackage('bio_four').guestCount,
};

function bookingRow(partial) {
  return {
    id: partial.id,
    status: partial.status || 'confirmed',
    booking_type: 'charter',
    charter_type: 'bio',
    charter_seating: 'shared',
    boat_id: 'boat-1',
    guest_count: partial.guest_count,
    start_time: partial.start_time,
    end_time: partial.end_time,
    expires_at: null,
  };
}

function run() {
  const zone = 'America/New_York';
  const start = DateTime.fromISO('2026-07-02T21:00', { zone }).toUTC().toISO();
  const end = DateTime.fromISO('2026-07-02T22:00', { zone }).toUTC().toISO();
  const row = (id, guest_count) => bookingRow({ id, guest_count, start_time: start, end_time: end });

  const assertCap = (overlapping, proposed, expectedAvailable, label) => {
    const result = evaluateSharedCharterCapacity({
      overlappingBookings: overlapping,
      proposedGuestCount: proposed,
    });
    assert.strictEqual(
      result.available,
      expectedAvailable,
      `${label}: expected available=${expectedAvailable}, got ${result.available}`
    );
  };

  assertCap([row('four', GUESTS.four)], GUESTS.solo, true, 'four + solo');
  assertCap([row('four', GUESTS.four)], GUESTS.two, false, 'four + two rejected');
  assertCap(
    [row('t1', GUESTS.two)],
    GUESTS.two,
    true,
    'first two-person package on empty slot'
  );
  assertCap(
    [row('t1', GUESTS.two), row('t2', GUESTS.two)],
    GUESTS.two,
    false,
    'two two-person packages full — third two rejected'
  );

  assertCap(
    [row('t1', GUESTS.two), row('t2', GUESTS.two)],
    GUESTS.two,
    false,
    'two two-person packages full — third two rejected'
  );
  assertCap(
    [row('t1', GUESTS.two), row('t2', GUESTS.two)],
    GUESTS.solo,
    true,
    'two two-person packages plus solo allowed'
  );

  const fiveSolos = Array.from({ length: 5 }, (_, i) => row(`s${i}`, GUESTS.solo));
  assertCap(fiveSolos.slice(0, 4), GUESTS.solo, true, 'four solos — fifth solo allowed');
  assertCap(fiveSolos, GUESTS.solo, false, 'five solos — sixth solo rejected');

  const tamper = evaluateSharedCharterCapacity({
    overlappingBookings: [row('two', GUESTS.two)],
    proposedGuestCount: GUESTS.four,
  });
  assert.strictEqual(tamper.available, false, 'browser-inflated guest count vs existing two-seat booking');

  console.log('bioPackageCapacityCombinations.test.js: all tests passed');
}

run();
