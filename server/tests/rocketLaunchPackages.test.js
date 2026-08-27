'use strict';

process.env.DIRECT_ROCKET_PACKAGE_PRICING_ENABLED = 'true';

const assert = require('assert');
const { getRocketLaunchPackage, isDirectRocketPackagePricingEnabled } = require('../config/rocketLaunchPackages');
const {
  validateDirectRocketPackageCheckout,
  rocketPackageExpectedTotals,
  stripeLineItemNameForRocketPackage,
  resolveCharterRocketPricing,
  resolveStaffRocketCharterPackage,
  assertRocketPackageRequestAllowed,
  rocketPackageBookingFields,
} = require('../services/rocketLaunchPackagePricing');

function loadPackagesModule() {
  const resolved = require.resolve('../config/rocketLaunchPackages');
  delete require.cache[resolved];
  return require('../config/rocketLaunchPackages');
}

function runPackageLookupTests() {
  const solo = getRocketLaunchPackage('rocket_solo');
  assert.strictEqual(solo.guestCount, 1);
  assert.strictEqual(solo.priceCents, 10000);

  const duo = getRocketLaunchPackage('rocket_duo');
  assert.strictEqual(duo.guestCount, 2);
  assert.strictEqual(duo.priceCents, 19000);

  const three = getRocketLaunchPackage('rocket_three');
  assert.strictEqual(three.guestCount, 3);
  assert.strictEqual(three.priceCents, 28000);
  assert.strictEqual(three.seating, 'shared');
  assert.strictEqual(three.capacityReserved, 3);

  const priv = getRocketLaunchPackage('rocket_private');
  assert.strictEqual(priv.priceCents, 45000);
  assert.strictEqual(priv.seating, 'private');

  assert.throws(() => getRocketLaunchPackage('rocket_five'), /Unknown rocket launch package/);
}

function runTamperingTests() {
  const ok = validateDirectRocketPackageCheckout({
    charterType: 'rocket',
    pricingPackageId: 'rocket_duo',
    passengerCountFromClient: 2,
    bookingSource: 'website',
  });
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.passengerCount, 2);
  assert.strictEqual(ok.charterVariant, 'shared');

  const mismatch = validateDirectRocketPackageCheckout({
    charterType: 'rocket',
    pricingPackageId: 'rocket_solo',
    passengerCountFromClient: 2,
    bookingSource: 'website',
  });
  assert.strictEqual(mismatch.ok, false);

  const threeOk = validateDirectRocketPackageCheckout({
    charterType: 'rocket',
    pricingPackageId: 'rocket_three',
    passengerCountFromClient: 3,
    bookingSource: 'website',
  });
  assert.strictEqual(threeOk.ok, true);
  assert.strictEqual(threeOk.passengerCount, 3);
  assert.strictEqual(threeOk.charterVariant, 'shared');

  const threeMismatch = validateDirectRocketPackageCheckout({
    charterType: 'rocket',
    pricingPackageId: 'rocket_three',
    passengerCountFromClient: 2,
    bookingSource: 'website',
  });
  assert.strictEqual(threeMismatch.ok, false);

  const missing = validateDirectRocketPackageCheckout({
    charterType: 'rocket',
    pricingPackageId: '',
    passengerCountFromClient: 1,
    bookingSource: 'website',
  });
  assert.strictEqual(missing.ok, false);
}

function runPrivatePackageTests() {
  const ok = validateDirectRocketPackageCheckout({
    charterType: 'rocket',
    pricingPackageId: 'rocket_private',
    passengerCountFromClient: 3,
    bookingSource: 'website',
  });
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.passengerCount, 3);
  assert.strictEqual(ok.charterVariant, 'private');

  const tooMany = validateDirectRocketPackageCheckout({
    charterType: 'rocket',
    pricingPackageId: 'rocket_private',
    passengerCountFromClient: 6,
    bookingSource: 'website',
  });
  assert.strictEqual(tooMany.ok, false);
}

function runStripeTotalsTests() {
  const soloTotals = rocketPackageExpectedTotals(getRocketLaunchPackage('rocket_solo'), 1);
  assert.strictEqual(Math.round(soloTotals.amountDueToday * 100), 10000);
  assert.strictEqual(soloTotals.charterVariant, 'shared');
  assert.strictEqual(
    stripeLineItemNameForRocketPackage(getRocketLaunchPackage('rocket_solo')),
    'Solo Rocket Launch Seat — 1 Guest'
  );

  const duoTotals = rocketPackageExpectedTotals(getRocketLaunchPackage('rocket_duo'), 2);
  assert.strictEqual(Math.round(duoTotals.amountDueToday * 100), 19000);

  const threeTotals = rocketPackageExpectedTotals(getRocketLaunchPackage('rocket_three'), 3);
  assert.strictEqual(Math.round(threeTotals.amountDueToday * 100), 28000);
  assert.strictEqual(
    stripeLineItemNameForRocketPackage(getRocketLaunchPackage('rocket_three')),
    'Rocket Launch for Three — 3 Guests'
  );

  const privateTotals = rocketPackageExpectedTotals(getRocketLaunchPackage('rocket_private'), 4);
  assert.strictEqual(Math.round(privateTotals.amountDueToday * 100), 45000);
  assert.strictEqual(privateTotals.charterVariant, 'private');
}

function runResolvePricingTests() {
  const resolved = resolveCharterRocketPricing({
    charterType: 'rocket',
    pricingPackageId: 'rocket_duo',
    passengerCount: 2,
    bookingSource: 'website',
  });
  assert.strictEqual(resolved.kind, 'package');
  assert.strictEqual(resolved.totals.totalPrice, 190);
  assert.strictEqual(resolved.charterVariant, 'shared');

  const required = resolveCharterRocketPricing({
    charterType: 'rocket',
    pricingPackageId: '',
    passengerCount: 2,
    bookingSource: 'website',
  });
  assert.strictEqual(required.kind, 'error');

  delete process.env.DIRECT_ROCKET_PACKAGE_PRICING_ENABLED;
  const legacy = resolveCharterRocketPricing({
    charterType: 'rocket',
    pricingPackageId: '',
    passengerCount: 2,
    bookingSource: 'website',
  });
  assert.strictEqual(legacy.kind, 'legacy');
  process.env.DIRECT_ROCKET_PACKAGE_PRICING_ENABLED = 'true';
}

function runGrouponIsolationTest() {
  const groupon = validateDirectRocketPackageCheckout({
    charterType: 'rocket',
    pricingPackageId: '',
    passengerCountFromClient: 2,
    bookingSource: 'groupon',
  });
  assert.strictEqual(groupon.ok, true);
  assert.strictEqual(groupon.skipPackage, true);
}

function runStaffRocketResolveTest() {
  const resolved = resolveStaffRocketCharterPackage({
    body: { charter_type: 'rocket', pricing_package_id: 'rocket_solo', booking_source: 'admin' },
    passengerCount: 1,
  });
  assert.strictEqual(resolved.ok, true);
  assert.strictEqual(resolved.charterType, 'rocket');
  assert.strictEqual(resolved.passengerCount, 1);
  assert.strictEqual(resolved.package?.priceCents, 10000);

  const privateResolved = resolveStaffRocketCharterPackage({
    body: { charter_type: 'rocket', pricing_package_id: 'rocket_private', booking_source: 'admin' },
    passengerCount: 5,
  });
  assert.strictEqual(privateResolved.ok, true);
  assert.strictEqual(privateResolved.charterVariant, 'private');
}

function runBookingFieldsTest() {
  const fields = rocketPackageBookingFields(getRocketLaunchPackage('rocket_private'), 3);
  assert.strictEqual(fields.pricing_package_id, 'rocket_private');
  assert.strictEqual(fields.package_guest_count, 3);
  assert.strictEqual(fields.final_amount_cents, 45000);
}

function runFeatureFlagTests() {
  delete process.env.DIRECT_ROCKET_PACKAGE_PRICING_ENABLED;
  assert.strictEqual(loadPackagesModule().isDirectRocketPackagePricingEnabled(), false);

  process.env.DIRECT_ROCKET_PACKAGE_PRICING_ENABLED = 'true';
  assert.strictEqual(isDirectRocketPackagePricingEnabled(), true);
}

function runGateTests() {
  const blocked = assertRocketPackageRequestAllowed({
    pricingPackageId: 'rocket_solo',
    charterType: 'bio',
    bookingMode: 'charter',
  });
  assert.strictEqual(blocked.ok, false);
  assert.strictEqual(blocked.code, 'rocket_package_invalid_context');

  delete process.env.DIRECT_ROCKET_PACKAGE_PRICING_ENABLED;
  const unavailable = assertRocketPackageRequestAllowed({
    pricingPackageId: 'rocket_solo',
    charterType: 'rocket',
    bookingMode: 'charter',
  });
  assert.strictEqual(unavailable.ok, false);
  assert.strictEqual(unavailable.code, 'rocket_package_pricing_unavailable');

  process.env.DIRECT_ROCKET_PACKAGE_PRICING_ENABLED = 'true';
  const allowed = assertRocketPackageRequestAllowed({
    pricingPackageId: 'rocket_solo',
    charterType: 'rocket',
    bookingMode: 'charter',
  });
  assert.strictEqual(allowed.ok, true);
}

function runAckTests() {
  const { assertSharedRocketMinimumAcknowledged, requiresSharedRocketMinimumAck } = require('../services/rocketLaunchPackagePricing');
  const solo = getRocketLaunchPackage('rocket_solo');
  const priv = getRocketLaunchPackage('rocket_private');
  assert.strictEqual(requiresSharedRocketMinimumAck(solo), true);
  assert.strictEqual(requiresSharedRocketMinimumAck(priv), false);

  const missing = assertSharedRocketMinimumAcknowledged({ rocketPackage: solo, acknowledged: false });
  assert.strictEqual(missing.ok, false);
  assert.strictEqual(missing.code, 'rocket_shared_minimum_ack_required');

  const ok = assertSharedRocketMinimumAcknowledged({ rocketPackage: solo, acknowledged: true });
  assert.strictEqual(ok.ok, true);

  const privateOk = assertSharedRocketMinimumAcknowledged({ rocketPackage: priv, acknowledged: false });
  assert.strictEqual(privateOk.ok, true);
}

function run() {
  runPackageLookupTests();
  runTamperingTests();
  runPrivatePackageTests();
  runStripeTotalsTests();
  runResolvePricingTests();
  runGrouponIsolationTest();
  runStaffRocketResolveTest();
  runBookingFieldsTest();
  runFeatureFlagTests();
  runGateTests();
  runAckTests();
  console.log('rocketLaunchPackages.test.js: all tests passed');
}

run();
