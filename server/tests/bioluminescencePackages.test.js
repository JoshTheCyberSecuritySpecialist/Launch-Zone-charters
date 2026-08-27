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
  assert.strictEqual(solo.priceCents, 4499);
  assert.strictEqual(solo.regularPriceCents, 5850);

  const two = getBioluminescencePackage('bio_two');
  assert.strictEqual(two.guestCount, 2);
  assert.strictEqual(two.priceCents, 8999);

  const three = getBioluminescencePackage('bio_three');
  assert.strictEqual(three.guestCount, 3);
  assert.strictEqual(three.priceCents, 13499);
  assert.strictEqual(three.regularPriceCents, 18000);

  const four = getBioluminescencePackage('bio_four');
  assert.strictEqual(four.guestCount, 4);
  assert.strictEqual(four.priceCents, 17999);

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

  const threeOk = validateDirectBioPackageCheckout({
    charterType: 'bio',
    pricingPackageId: 'bio_three',
    passengerCountFromClient: 3,
    bookingSource: 'website',
  });
  assert.strictEqual(threeOk.ok, true);
  assert.strictEqual(threeOk.passengerCount, 3);

  const threeMismatch = validateDirectBioPackageCheckout({
    charterType: 'bio',
    pricingPackageId: 'bio_three',
    passengerCountFromClient: 2,
    bookingSource: 'website',
  });
  assert.strictEqual(threeMismatch.ok, false);

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
  assert.strictEqual(Math.round(soloTotals.amountDueToday * 100), 4499);
  assert.strictEqual(stripeLineItemNameForBioPackage(getBioluminescencePackage('bio_solo')), 'Solo Bioluminescence Night Tour — 1 Guest');

  const twoTotals = bioPackageExpectedTotals(getBioluminescencePackage('bio_two'));
  assert.strictEqual(Math.round(twoTotals.amountDueToday * 100), 8999);

  const threeTotals = bioPackageExpectedTotals(getBioluminescencePackage('bio_three'));
  assert.strictEqual(Math.round(threeTotals.amountDueToday * 100), 13499);
  assert.strictEqual(
    stripeLineItemNameForBioPackage(getBioluminescencePackage('bio_three')),
    'Bioluminescence Night Tour — 3 Guests'
  );

  const fourTotals = bioPackageExpectedTotals(getBioluminescencePackage('bio_four'));
  assert.strictEqual(Math.round(fourTotals.amountDueToday * 100), 17999);
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

function runStaffBioResolveTest() {
  const { resolveStaffBioCharterPackage } = require('../services/bioluminescencePackagePricing');
  const resolved = resolveStaffBioCharterPackage({
    body: { charter_type: 'bio', pricing_package_id: 'bio_solo', booking_source: 'admin' },
    passengerCount: 1,
  });
  assert.strictEqual(resolved.ok, true);
  assert.strictEqual(resolved.charterType, 'bio');
  assert.strictEqual(resolved.passengerCount, 1);
  assert.strictEqual(resolved.package?.priceCents, 4499);

  const bad = resolveStaffBioCharterPackage({
    body: { charter_type: 'bio', pricing_package_id: 'bio_two', booking_source: 'admin' },
    passengerCount: 4,
  });
  assert.strictEqual(bad.ok, false);
}

function run() {
  runPackageLookupTests();
  runTamperingTests();
  runStripeTotalsTests();
  runCapacityTests();
  runGrouponIsolationTest();
  runStaffBioResolveTest();
  console.log('bioluminescencePackages.test.js: all tests passed');
}

run();
