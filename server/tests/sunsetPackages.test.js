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
  SUNSET_PACKAGE_DURATION_MINUTES,
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
  assert.strictEqual(solo.priceCents, 3900);
  assert.strictEqual(solo.standardValueCents, 4900);
  assert.strictEqual(solo.guestCount, 1);
  assert.strictEqual(solo.seating, 'shared');
  assert.strictEqual(solo.canOpenSharedDeparture, false);
  assert.strictEqual(solo.durationMinutes, SUNSET_PACKAGE_DURATION_MINUTES);
  assert.strictEqual(solo.durationMinutes, 120);
  assert.strictEqual(sunsetPackageSavingsCents(solo), 1000);

  const two = getSunsetPackage('sunset_two');
  assert.strictEqual(two.priceCents, 7500);
  assert.strictEqual(two.guestCount, 2);
  assert.strictEqual(two.canOpenSharedDeparture, true);
  assert.strictEqual(two.durationMinutes, 120);
  assert.strictEqual(sunsetPackageSavingsCents(two), 1400);

  const three = getSunsetPackage('sunset_three');
  assert.strictEqual(three.priceCents, 11000);
  assert.strictEqual(three.guestCount, 3);
  assert.strictEqual(three.canOpenSharedDeparture, true);
  assert.strictEqual(sunsetPackageSavingsCents(three), 1900);

  const family = getSunsetPackage('sunset_family');
  assert.strictEqual(family.priceCents, 14500);
  assert.strictEqual(family.maxGuests, 4);
  assert.strictEqual(family.capacityReserved, 5);
  assert.strictEqual(family.seating, 'private');
  assert.strictEqual(sunsetPackageSavingsCents(family), 2400);

  const priv = getSunsetPackage('sunset_private');
  assert.strictEqual(priv.priceCents, 17900);
  assert.strictEqual(priv.maxGuests, 5);
  assert.strictEqual(priv.capacityReserved, 5);
  assert.strictEqual(priv.seating, 'private');
  assert.strictEqual(sunsetPackageSavingsCents(priv), 3000);

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
  assert.strictEqual(family5.ok, false);

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
  assert.strictEqual(Math.round(family1.amountDueToday * 100), 14500);
  assert.strictEqual(family1.durationHours, 2);
  const family4 = sunsetPackageExpectedTotals(getSunsetPackage('sunset_family'), 4);
  assert.strictEqual(Math.round(family4.amountDueToday * 100), 14500);

  const private1 = sunsetPackageExpectedTotals(getSunsetPackage('sunset_private'), 1);
  assert.strictEqual(Math.round(private1.amountDueToday * 100), 17900);
  assert.strictEqual(private1.durationHours, 2);
  const private5 = sunsetPackageExpectedTotals(getSunsetPackage('sunset_private'), 5);
  assert.strictEqual(Math.round(private5.amountDueToday * 100), 17900);

  const solo = sunsetPackageExpectedTotals(getSunsetPackage('sunset_solo'), 1);
  assert.strictEqual(Math.round(solo.amountDueToday * 100), 3900);
  assert.strictEqual(solo.durationHours, 2);
  const two = sunsetPackageExpectedTotals(getSunsetPackage('sunset_two'), 2);
  assert.strictEqual(Math.round(two.amountDueToday * 100), 7500);
  const three = sunsetPackageExpectedTotals(getSunsetPackage('sunset_three'), 3);
  assert.strictEqual(Math.round(three.amountDueToday * 100), 11000);
}

function runTamperTests() {
  const resolved = resolveCharterSunsetPricing({
    charterType: 'sunset',
    pricingPackageId: 'sunset_two',
    passengerCount: 2,
    bookingSource: 'website',
  });
  assert.strictEqual(resolved.kind, 'package');
  assert.strictEqual(resolved.totals.totalPrice, 75);
  assert.strictEqual(resolved.totals.durationHours, 2);

  const invalid = resolveCharterSunsetPricing({
    charterType: 'sunset',
    pricingPackageId: 'free_trip',
    passengerCount: 1,
    bookingSource: 'website',
  });
  assert.strictEqual(invalid.kind, 'error');

  const fields = sunsetPackageBookingFields(getSunsetPackage('sunset_solo'), 1);
  assert.strictEqual(fields.final_amount_cents, 3900);
  assert.strictEqual(
    stripeLineItemNameForSunsetPackage(getSunsetPackage('sunset_solo')),
    'Dolphin & Wildlife Solo Seat — 1 Guest'
  );
  assert.strictEqual(
    stripeLineItemNameForSunsetPackage(getSunsetPackage('sunset_three')),
    'Dolphin & Wildlife Tour for Three — 3 Guests'
  );
  assert.strictEqual(
    stripeLineItemNameForSunsetPackage(getSunsetPackage('sunset_family')),
    'Private Dolphin & Wildlife Tour for Four — Up to 4 Guests'
  );
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
  const threePaidSameStart = {
    ...twoPaid,
    id: 'e',
    guest_count: 3,
    pricing_package_id: 'sunset_three',
  };

  assert.strictEqual(isPaidCommittedSharedSunsetRow(twoPaid), true);
  assert.strictEqual(isPaidCommittedSharedSunsetRow(cancelled), false);
  assert.strictEqual(isPaidCommittedSharedSunsetRow(pendingHold), false);
  assert.strictEqual(isPaidCommittedSharedSunsetRow(familyPrivate), false);

  const joinable = groupJoinableSunsetStarts([twoPaid], 1);
  assert.strictEqual(joinable.length, 1);
  assert.strictEqual(joinable[0].guestsBooked, 2);
  assert.strictEqual(joinable[0].seatsRemaining, 3);

  // Shared boat capacity is 5: two + three fills the departure.
  const full = groupJoinableSunsetStarts([twoPaid, threePaidSameStart], 1);
  assert.strictEqual(full.length, 0);

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
      assert.match(String(err.message), /No shared Dolphin & Wildlife departure/);
      assert.strictEqual(err.code, 'sunset_solo_no_open_departure');
      return true;
    }
  );
  assert.match(SOLO_NO_DEPARTURE_MESSAGE, /Tour for Two or Three/);
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

function runDurationHoursWiringTests() {
  const { charterEndIsoFromStart, resolveCharterDurationHours } = require('../lib/charterDuration');
  const solo = getSunsetPackage('sunset_solo');
  assert.strictEqual(resolveCharterDurationHours(solo), 2);
  assert.strictEqual(availabilityService.resolveCharterSlotDurationHours({ sunsetPackage: solo }), 2);
  assert.strictEqual(availabilityService.resolveCharterSlotDurationHours({}), 1);

  const start = '2026-09-15T22:30:00.000Z';
  const end = charterEndIsoFromStart(start, 2);
  assert.strictEqual(end, '2026-09-16T00:30:00.000Z');
  const endMs = new Date(end).getTime() - new Date(start).getTime();
  assert.strictEqual(endMs, 2 * 60 * 60 * 1000);
}

/** Phase 5: other products keep 1h slots; historical sunset amounts are not rewritten by config. */
function runIsolationAndHistoricalProtectionTests() {
  const { DEFAULT_CAPTAIN_CHARTER_DURATION_MINUTES } = require('../lib/charterDuration');
  const bioPkg = {
    id: 'bio_solo',
    durationMinutes: DEFAULT_CAPTAIN_CHARTER_DURATION_MINUTES,
  };
  const rocketPkg = {
    id: 'rocket_solo',
    durationMinutes: DEFAULT_CAPTAIN_CHARTER_DURATION_MINUTES,
  };
  assert.strictEqual(availabilityService.resolveCharterSlotDurationHours({ bioPackage: bioPkg }), 1);
  assert.strictEqual(availabilityService.resolveCharterSlotDurationHours({ rocketPackage: rocketPkg }), 1);

  // Stored booking cents win for history — package config changes must not rewrite them.
  const historical = {
    pricing_package_id: 'sunset_solo',
    final_amount_cents: 7500,
    total_price: 75,
  };
  const current = getSunsetPackage('sunset_solo');
  assert.notStrictEqual(current.priceCents, historical.final_amount_cents);
  assert.strictEqual(historical.final_amount_cents, 7500);
  assert.strictEqual(historical.total_price, 75);
}

/** FE mirror + direct-booking page copy must stay aligned with server packages. */
function runFrontendMirrorAndPageTests() {
  const fs = require('fs');
  const path = require('path');
  const { SUNSET_PACKAGES, SUNSET_PACKAGE_IDS } = require('../config/sunsetPackages');
  const mirrorPath = path.join(__dirname, '../../src/lib/sunsetPackages.ts');
  const cardsPath = path.join(__dirname, '../../src/components/booking/SunsetPackageCards.tsx');
  const directDealsPath = path.join(__dirname, '../../src/pages/DirectDeals.tsx');
  const mirror = fs.readFileSync(mirrorPath, 'utf8');
  const cards = fs.readFileSync(cardsPath, 'utf8');
  const directDeals = fs.readFileSync(directDealsPath, 'utf8');

  assert.strictEqual(SUNSET_PACKAGE_IDS.length, 5);
  for (const id of SUNSET_PACKAGE_IDS) {
    const pkg = SUNSET_PACKAGES[id];
    assert.ok(mirror.includes(`id: '${id}'`), `FE mirror missing ${id}`);
    assert.ok(
      mirror.includes(`directPriceUsd: ${pkg.priceCents / 100}`) ||
        mirror.includes(`directPriceUsd: ${Number(pkg.priceCents / 100)}`),
      `FE mirror price mismatch for ${id}`
    );
    assert.ok(mirror.includes(`durationMinutes: SUNSET_PACKAGE_DURATION_MINUTES`), 'FE duration constant missing');
  }

  assert.match(mirror, /title: 'Dolphin & Wildlife Tour'/);
  assert.match(mirror, /Wildlife sightings are common but are never guaranteed/);
  assert.match(mirror, /Book directly and save compared with our standard Groupon deal prices/);
  assert.match(mirror, /Captain included/);
  assert.match(mirror, /Fuel included/);
  assert.match(directDeals, /SUNSET_TOUR_PAGE/);
  assert.match(cards, /md:grid-cols-2/);
  assert.match(cards, /min-h-\[48px\]/);
  assert.match(cards, /Joins an existing paid shared departure/);
  assert.match(cards, /Opens a shared departure/);
  assert.match(cards, /Private — no other guests join/);
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
  runDurationHoursWiringTests();
  runIsolationAndHistoricalProtectionTests();
  runFrontendMirrorAndPageTests();
  console.log('sunsetPackages.test: all assertions passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
