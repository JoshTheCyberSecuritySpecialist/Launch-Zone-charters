'use strict';

process.env.DIRECT_BIO_PACKAGE_PRICING_ENABLED = 'true';

const assert = require('assert');
const { getBioluminescencePackage } = require('../config/bioluminescencePackages');
const {
  validateDirectBioPackageCheckout,
  bioPackageExpectedTotals,
  stripeLineItemNameForBioPackage,
} = require('../services/bioluminescencePackagePricing');
const { evaluateSharedCharterCapacity } = require('../lib/sharedCharterCapacity');

function bookingRow(partial) {
  return {
    id: partial.id,
    status: partial.status || 'confirmed',
    booking_type: partial.booking_type || 'charter',
    charter_type: partial.charter_type || 'bio',
    charter_seating: partial.charter_seating ?? 'shared',
    boat_id: partial.boat_id || 'boat-1',
    guest_count: partial.guest_count,
    start_time: partial.start_time,
    end_time: partial.end_time,
    expires_at: partial.expires_at || null,
  };
}

function runPackageLookupTests() {
  const solo = getBioluminescencePackage('bio_solo');
  assert.strictEqual(solo.guestCount, 1);
  assert.strictEqual(solo.priceCents, 4000);

  const two = getBioluminescencePackage('bio_two');
  assert.strictEqual(two.guestCount, 2);
  assert.strictEqual(two.priceCents, 7800);

  const four = getBioluminescencePackage('bio_four');
  assert.strictEqual(four.guestCount, 4);
  assert.strictEqual(four.priceCents, 15000);

  assert.throws(() => getBioluminescencePackage('bio_five'), /Unknown bioluminescence package/);
}

function runTamperingTests() {
  const ok = validateDirectBioPackageCheckout({
    charterType: 'bio',
    pricingPackageId: 'bio_two',
    passengerCountFromClient: 2,
    bookingSource: 'website',
  });
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.passengerCount, 2);

  const mismatch = validateDirectBioPackageCheckout({
    charterType: 'bio',
    pricingPackageId: 'bio_four',
    passengerCountFromClient: 5,
    bookingSource: 'website',
  });
  assert.strictEqual(mismatch.ok, false);

  const soloMismatch = validateDirectBioPackageCheckout({
    charterType: 'bio',
    pricingPackageId: 'bio_two',
    passengerCountFromClient: 1,
    bookingSource: 'website',
  });
  assert.strictEqual(soloMismatch.ok, false);

  const missing = validateDirectBioPackageCheckout({
    charterType: 'bio',
    pricingPackageId: '',
    passengerCountFromClient: 2,
    bookingSource: 'website',
  });
  assert.strictEqual(missing.ok, false);
}

function runStripeTotalsTests() {
  const soloTotals = bioPackageExpectedTotals(getBioluminescencePackage('bio_solo'));
  assert.strictEqual(Math.round(soloTotals.amountDueToday * 100), 4000);
  assert.strictEqual(stripeLineItemNameForBioPackage(getBioluminescencePackage('bio_solo')), 'Solo Bioluminescence Night Tour — 1 Guest');

  const twoTotals = bioPackageExpectedTotals(getBioluminescencePackage('bio_two'));
  assert.strictEqual(Math.round(twoTotals.amountDueToday * 100), 7800);

  const fourTotals = bioPackageExpectedTotals(getBioluminescencePackage('bio_four'));
  assert.strictEqual(Math.round(fourTotals.amountDueToday * 100), 15000);
}

function runCapacityTests() {
  const { DateTime } = require('luxon');
  const zone = 'America/New_York';
  const start = DateTime.fromISO('2026-07-02T21:00', { zone }).toUTC().toISO();
  const end = DateTime.fromISO('2026-07-02T22:00', { zone }).toUTC().toISO();

  const row = (partial) =>
    bookingRow({
      charter_type: 'bio',
      guest_count: partial.guest_count,
      start_time: start,
      end_time: end,
      id: partial.id,
    });

  let result = evaluateSharedCharterCapacity({
    overlappingBookings: [row({ id: 'a', guest_count: 4 })],
    proposedGuestCount: 2,
  });
  assert.strictEqual(result.available, false);

  result = evaluateSharedCharterCapacity({
    overlappingBookings: [row({ id: 'a', guest_count: 2 })],
    proposedGuestCount: 2,
  });
  assert.strictEqual(result.available, true);

  const fiveSingles = Array.from({ length: 5 }, (_, i) => row({ id: String(i), guest_count: 1 }));
  result = evaluateSharedCharterCapacity({
    overlappingBookings: fiveSingles,
    proposedGuestCount: 1,
  });
  assert.strictEqual(result.available, false);
}

function runGrouponIsolationTest() {
  const groupon = validateDirectBioPackageCheckout({
    charterType: 'bio',
    pricingPackageId: '',
    passengerCountFromClient: 2,
    bookingSource: 'groupon',
  });
  assert.strictEqual(groupon.ok, true);
  assert.strictEqual(groupon.skipPackage, true);
}

function run() {
  runPackageLookupTests();
  runTamperingTests();
  runStripeTotalsTests();
  runCapacityTests();
  runGrouponIsolationTest();
  console.log('bioluminescencePackages.test.js: all tests passed');
}

run();
