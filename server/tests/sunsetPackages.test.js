'use strict';

process.env.DIRECT_SUNSET_PACKAGE_PRICING_ENABLED = 'true';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.BUSINESS_TIMEZONE = process.env.BUSINESS_TIMEZONE || 'America/New_York';

const assert = require('assert');
const {
  getSunsetPackage,
  isDirectSunsetPackagePricingEnabled,
  sunsetPackageSavingsCents,
} = require('../config/sunsetPackages');
const {
  validateDirectSunsetPackageCheckout,
  sunsetPackageExpectedTotals,
  stripeLineItemNameForSunsetPackage,
  resolveCharterSunsetPricing,
  sunsetPackageBookingFields,
  assertSunsetPackageRequestAllowed,
} = require('../services/sunsetPackagePricing');
const {
  groupJoinableSunsetStarts,
  isPaidCommittedSharedSunsetRow,
  SOLO_NO_DEPARTURE_MESSAGE,
  assertSunsetSoloCanJoin,
} = require('../services/sunsetDepartureService');
const availabilityService = require('../services/availabilityService');

function runPackageLookupTests() {
  const solo = getSunsetPackage('sunset_solo');
  assert.strictEqual(solo.priceCents, 7500);
  assert.strictEqual(solo.standardValueCents, 8500);
  assert.strictEqual(solo.guestCount, 1);
  assert.strictEqual(solo.seating, 'shared');
  assert.strictEqual(solo.canOpenSharedDeparture, false);
  assert.strictEqual(sunsetPackageSavingsCents(solo), 1000);

  const two = getSunsetPackage('sunset_two');
  assert.strictEqual(two.priceCents, 14000);
  assert.strictEqual(two.guestCount, 2);
  assert.strictEqual(two.canOpenSharedDeparture, true);
  assert.strictEqual(sunsetPackageSavingsCents(two), 2000);

  const three = getSunsetPackage('sunset_three');
  assert.strictEqual(three.priceCents, 21000);
  assert.strictEqual(three.guestCount, 3);
  assert.strictEqual(three.canOpenSharedDeparture, true);
  assert.strictEqual(sunsetPackageSavingsCents(three), 3000);

  const family = getSunsetPackage('sunset_family');
  assert.strictEqual(family.priceCents, 25000);
  assert.strictEqual(family.maxGuests, 5);
  assert.strictEqual(family.seating, 'private');
  assert.strictEqual(sunsetPackageSavingsCents(family), 3500);

  const priv = getSunsetPackage('sunset_private');
  assert.strictEqual(priv.priceCents, 32500);
  assert.strictEqual(priv.maxGuests, 5);
  assert.strictEqual(priv.seating, 'private');
  assert.strictEqual(sunsetPackageSavingsCents(priv), 5000);

  assert.throws(() => getSunsetPackage('sunset_free'), /Unknown sunset package/);
}

function runGuestRuleTests() {
  const soloOk = validateDirectSunsetPackageCheckout({
    charterType: 'sunset',
    pricingPackageId: 'sunset_solo',
    passengerCountFromClient: 1,
    bookingSource: 'website',
  });
  assert.strictEqual(soloOk.ok, true);
  assert.strictEqual(soloOk.charterVariant, 'shared');

  const soloBad = validateDirectSunsetPackageCheckout({
    charterType: 'sunset',
    pricingPackageId: 'sunset_solo',
    passengerCountFromClient: 5,
    bookingSource: 'website',
  });
  assert.strictEqual(soloBad.ok, false);

  const twoBad = validateDirectSunsetPackageCheckout({
    charterType: 'sunset',
    pricingPackageId: 'sunset_two',
    passengerCountFromClient: 1,
    bookingSource: 'website',
  });
  assert.strictEqual(twoBad.ok, false);

  const threeOk = validateDirectSunsetPackageCheckout({
    charterType: 'sunset',
    pricingPackageId: 'sunset_three',
    passengerCountFromClient: 3,
    bookingSource: 'website',
  });
  assert.strictEqual(threeOk.ok, true);
  assert.strictEqual(threeOk.passengerCount, 3);
  assert.strictEqual(threeOk.charterVariant, 'shared');

  const threeBad = validateDirectSunsetPackageCheckout({
    charterType: 'sunset',
    pricingPackageId: 'sunset_three',
    passengerCountFromClient: 2,
    bookingSource: 'website',
  });
  assert.strictEqual(threeBad.ok, false);

  const family1 = validateDirectSunsetPackageCheckout({
    charterType: 'sunset',
    pricingPackageId: 'sunset_family',
    passengerCountFromClient: 1,
    bookingSource: 'website',
  });
  assert.strictEqual(family1.ok, true);
  assert.strictEqual(family1.charterVariant, 'private');

  const family4 = validateDirectSunsetPackageCheckout({
    charterType: 'sunset',
    pricingPackageId: 'sunset_family',
    passengerCountFromClient: 4,
    bookingSource: 'website',
  });
  assert.strictEqual(family4.ok, true);

  const family5 = validateDirectSunsetPackageCheckout({
    charterType: 'sunset',
    pricingPackageId: 'sunset_family',
    passengerCountFromClient: 5,
    bookingSource: 'website',
  });
  assert.strictEqual(family5.ok, true);

  const family6 = validateDirectSunsetPackageCheckout({
    charterType: 'sunset',
    pricingPackageId: 'sunset_family',
    passengerCountFromClient: 6,
    bookingSource: 'website',
  });
  assert.strictEqual(family6.ok, false);

  const private5 = validateDirectSunsetPackageCheckout({
    charterType: 'sunset',
    pricingPackageId: 'sunset_private',
    passengerCountFromClient: 5,
    bookingSource: 'website',
  });
  assert.strictEqual(private5.ok, true);

  const private6 = validateDirectSunsetPackageCheckout({
    charterType: 'sunset',
    pricingPackageId: 'sunset_private',
    passengerCountFromClient: 6,
    bookingSource: 'website',
  });
  assert.strictEqual(private6.ok, false);
}

function runFixedPriceTests() {
  const family1 = sunsetPackageExpectedTotals(getSunsetPackage('sunset_family'), 1);
  assert.strictEqual(Math.round(family1.amountDueToday * 100), 25000);
  const family5 = sunsetPackageExpectedTotals(getSunsetPackage('sunset_family'), 5);
  assert.strictEqual(Math.round(family5.amountDueToday * 100), 25000);

  const private1 = sunsetPackageExpectedTotals(getSunsetPackage('sunset_private'), 1);
  assert.strictEqual(Math.round(private1.amountDueToday * 100), 32500);
  const private5 = sunsetPackageExpectedTotals(getSunsetPackage('sunset_private'), 5);
  assert.strictEqual(Math.round(private5.amountDueToday * 100), 32500);

  const solo = sunsetPackageExpectedTotals(getSunsetPackage('sunset_solo'), 1);
  assert.strictEqual(Math.round(solo.amountDueToday * 100), 7500);
  const two = sunsetPackageExpectedTotals(getSunsetPackage('sunset_two'), 2);
  assert.strictEqual(Math.round(two.amountDueToday * 100), 14000);
  const three = sunsetPackageExpectedTotals(getSunsetPackage('sunset_three'), 3);
  assert.strictEqual(Math.round(three.amountDueToday * 100), 21000);
}

function runTamperTests() {
  const resolved = resolveCharterSunsetPricing({
    charterType: 'sunset',
    pricingPackageId: 'sunset_two',
    passengerCount: 2,
    bookingSource: 'website',
  });
  assert.strictEqual(resolved.kind, 'package');
  assert.strictEqual(resolved.totals.totalPrice, 140);

  const invalid = resolveCharterSunsetPricing({
    charterType: 'sunset',
    pricingPackageId: 'free_trip',
    passengerCount: 1,
    bookingSource: 'website',
  });
  assert.strictEqual(invalid.kind, 'error');

  const fields = sunsetPackageBookingFields(getSunsetPackage('sunset_solo'), 1);
  assert.strictEqual(fields.final_amount_cents, 7500);
  assert.strictEqual(stripeLineItemNameForSunsetPackage(getSunsetPackage('sunset_solo')), 'Sunset Solo Seat — 1 Guest');
  assert.strictEqual(stripeLineItemNameForSunsetPackage(getSunsetPackage('sunset_three')), 'Sunset for Three — 3 Guests');
}

function runJoinableDepartureTests() {
  const twoPaid = {
    id: 'a',
    booking_type: 'charter',
    charter_type: 'sunset',
    charter_seating: 'shared',
    status: 'confirmed',
    payment_status: 'paid',
    guest_count: 2,
    pricing_package_id: 'sunset_two',
    start_time: '2026-08-21T22:30:00.000Z',
  };
  const cancelled = {
    ...twoPaid,
    id: 'b',
    status: 'cancelled',
    start_time: '2026-08-22T22:30:00.000Z',
  };
  const pendingHold = {
    ...twoPaid,
    id: 'c',
    status: 'pending',
    payment_status: 'pending',
    start_time: '2026-08-23T22:30:00.000Z',
  };
  const familyPrivate = {
    ...twoPaid,
    id: 'd',
    charter_seating: 'private',
    pricing_package_id: 'sunset_family',
    guest_count: 4,
  };

  assert.strictEqual(isPaidCommittedSharedSunsetRow(twoPaid), true);
  assert.strictEqual(isPaidCommittedSharedSunsetRow(cancelled), false);
  assert.strictEqual(isPaidCommittedSharedSunsetRow(pendingHold), false);
  assert.strictEqual(isPaidCommittedSharedSunsetRow(familyPrivate), false);

  const joinable = groupJoinableSunsetStarts([twoPaid], 1);
  assert.strictEqual(joinable.length, 1);
  assert.strictEqual(joinable[0].guestsBooked, 2);
  assert.strictEqual(joinable[0].seatsRemaining, 3);

  const none = groupJoinableSunsetStarts([cancelled, pendingHold], 1);
  assert.strictEqual(none.length, 0);
}

async function runSoloJoinRejectTests() {
  const emptyQuery = {
    select() {
      return emptyQuery;
    },
    eq() {
      return emptyQuery;
    },
    then(resolve) {
      return Promise.resolve({ data: [], error: null }).then(resolve);
    },
  };
  const supabase = {
    from() {
      return emptyQuery;
    },
  };
  await assert.rejects(
    () =>
      assertSunsetSoloCanJoin(supabase, {
        boatId: 'boat-1',
        startTime: '2026-08-21T22:30:00.000Z',
        passengerCount: 1,
      }),
    (err) => {
      assert.match(String(err.message), /No shared sunset departure/);
      assert.strictEqual(err.code, 'sunset_solo_no_open_departure');
      return true;
    }
  );
  assert.strictEqual(
    availabilityService.isSharedCharterBookingRequest({
      charterType: 'sunset',
      sunsetPackage: { seating: 'shared' },
    }),
    true
  );
  assert.strictEqual(
    availabilityService.isSharedCharterBookingRequest({
      charterType: 'sunset',
      sunsetPackage: { seating: 'private' },
    }),
    false
  );
}

function runGrouponSkipTest() {
  const skipped = validateDirectSunsetPackageCheckout({
    charterType: 'sunset',
    pricingPackageId: 'sunset_solo',
    passengerCountFromClient: 1,
    bookingSource: 'groupon',
  });
  assert.strictEqual(skipped.ok, true);
  assert.strictEqual(skipped.skipPackage, true);
}

function runFlagAndGateTests() {
  assert.strictEqual(isDirectSunsetPackagePricingEnabled(), true);
  const gate = assertSunsetPackageRequestAllowed({
    pricingPackageId: 'sunset_solo',
    charterType: 'sunset',
    bookingMode: 'charter',
  });
  assert.strictEqual(gate.ok, true);

  const wrongType = assertSunsetPackageRequestAllowed({
    pricingPackageId: 'sunset_solo',
    charterType: 'bio',
    bookingMode: 'charter',
  });
  assert.strictEqual(wrongType.ok, false);
}

async function run() {
  runPackageLookupTests();
  runGuestRuleTests();
  runFixedPriceTests();
  runTamperTests();
  runJoinableDepartureTests();
  await runSoloJoinRejectTests();
  runGrouponSkipTest();
  runFlagAndGateTests();
  console.log('sunsetPackages.test: all assertions passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
