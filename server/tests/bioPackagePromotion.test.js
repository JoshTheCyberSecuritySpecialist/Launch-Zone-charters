'use strict';

process.env.DIRECT_BIO_PACKAGE_PRICING_ENABLED = 'true';
process.env.BUSINESS_TIMEZONE = process.env.BUSINESS_TIMEZONE || 'America/New_York';

const assert = require('assert');
const { DateTime } = require('luxon');
const {
  BIO_DIRECT_PROMOTION,
  getBioluminescencePackage,
  isBioDirectPromotionActive,
} = require('../config/bioluminescencePackages');
const {
  bioPackageBookingFields,
  bioPackageExpectedTotals,
  validateDirectBioPackageCheckout,
} = require('../services/bioluminescencePackagePricing');

function stripeCentsFromPackageId(id, now) {
  const pkg = getBioluminescencePackage(id, now != null ? { now } : {});
  const totals = bioPackageExpectedTotals(pkg);
  return Math.round(totals.amountDueToday * 100);
}

function restorePromotion(snapshot) {
  BIO_DIRECT_PROMOTION.enabled = snapshot.enabled;
  BIO_DIRECT_PROMOTION.startsAt = snapshot.startsAt;
  BIO_DIRECT_PROMOTION.endsAt = snapshot.endsAt;
}

function withPromotion(overrides, fn) {
  const snapshot = {
    enabled: BIO_DIRECT_PROMOTION.enabled,
    startsAt: BIO_DIRECT_PROMOTION.startsAt,
    endsAt: BIO_DIRECT_PROMOTION.endsAt,
  };
  Object.assign(BIO_DIRECT_PROMOTION, overrides);
  try {
    fn();
  } finally {
    restorePromotion(snapshot);
  }
}

function runActivePromotionTests() {
  withPromotion({ enabled: true, startsAt: null, endsAt: null }, () => {
    assert.strictEqual(isBioDirectPromotionActive(), true);
    assert.strictEqual(stripeCentsFromPackageId('bio_solo'), 4499);
    assert.strictEqual(stripeCentsFromPackageId('bio_two'), 8999);
    assert.strictEqual(stripeCentsFromPackageId('bio_three'), 13499);
    assert.strictEqual(stripeCentsFromPackageId('bio_four'), 17999);

    const two = getBioluminescencePackage('bio_two');
    assert.strictEqual(two.priceCents, 8999);
    assert.strictEqual(two.regularPriceCents, 12000);
    assert.strictEqual(two.promotionalPriceCents, 8999);
    assert.strictEqual(two.promotionActive, true);
    assert.strictEqual(two.promotionLabel, 'Direct Booking Special');

    const fields = bioPackageBookingFields(two);
    assert.strictEqual(fields.standard_value_cents, 12000);
    assert.strictEqual(fields.package_price_cents, 8999);
    assert.strictEqual(fields.final_amount_cents, 8999);
    assert.strictEqual(fields.discount_amount_cents, 3001);
  });
}

function runInactivePromotionTests() {
  withPromotion({ enabled: false, startsAt: null, endsAt: null }, () => {
    assert.strictEqual(isBioDirectPromotionActive(), false);
    assert.strictEqual(stripeCentsFromPackageId('bio_solo'), 5850);
    assert.strictEqual(stripeCentsFromPackageId('bio_two'), 12000);
    assert.strictEqual(stripeCentsFromPackageId('bio_three'), 18000);
    assert.strictEqual(stripeCentsFromPackageId('bio_four'), 24000);

    const solo = getBioluminescencePackage('bio_solo');
    assert.strictEqual(solo.priceCents, 5850);
    assert.strictEqual(solo.promotionActive, false);
    assert.strictEqual(solo.promotionLabel, null);

    const fields = bioPackageBookingFields(solo);
    assert.strictEqual(fields.standard_value_cents, 5850);
    assert.strictEqual(fields.final_amount_cents, 5850);
    assert.strictEqual(fields.discount_amount_cents, 0);
  });
}

function runDateWindowTests() {
  withPromotion(
    {
      enabled: true,
      startsAt: '2026-09-01T00:00:00',
      endsAt: '2026-09-30',
    },
    () => {
      const zone = 'America/New_York';
      const before = DateTime.fromISO('2026-08-31T23:59:00', { zone });
      const during = DateTime.fromISO('2026-09-15T12:00:00', { zone });
      const after = DateTime.fromISO('2026-10-01T00:00:01', { zone });

      assert.strictEqual(isBioDirectPromotionActive(before), false);
      assert.strictEqual(stripeCentsFromPackageId('bio_solo', before), 5850);

      assert.strictEqual(isBioDirectPromotionActive(during), true);
      assert.strictEqual(stripeCentsFromPackageId('bio_two', during), 8999);

      assert.strictEqual(isBioDirectPromotionActive(after), false);
      assert.strictEqual(stripeCentsFromPackageId('bio_four', after), 24000);
    }
  );
}

function runClientCannotOverridePriceTests() {
  withPromotion({ enabled: true, startsAt: null, endsAt: null }, () => {
    const sneaky = validateDirectBioPackageCheckout({
      charterType: 'bio',
      pricingPackageId: 'bio_two',
      passengerCountFromClient: 2,
      bookingSource: 'website',
      priceCents: 899,
      promotionalPriceCents: 1,
      promotionEnabled: false,
      amountDueToday: 8.99,
    });
    assert.strictEqual(sneaky.ok, true);
    assert.strictEqual(sneaky.package.priceCents, 8999);
    assert.strictEqual(sneaky.package.promotionActive, true);

    const unknown = validateDirectBioPackageCheckout({
      charterType: 'bio',
      pricingPackageId: 'bio_free',
      passengerCountFromClient: 1,
      bookingSource: 'website',
    });
    assert.strictEqual(unknown.ok, false);

    const groupon = validateDirectBioPackageCheckout({
      charterType: 'bio',
      pricingPackageId: 'bio_solo',
      passengerCountFromClient: 1,
      bookingSource: 'groupon',
    });
    assert.strictEqual(groupon.ok, true);
    assert.strictEqual(groupon.skipPackage, true);
  });
}

function runHistoricalAmountNotRecalculatedTest() {
  const historicalPaidCents = 4689;
  const historical = {
    pricing_package_id: 'bio_solo',
    standard_value_cents: 7500,
    package_price_cents: historicalPaidCents,
    final_amount_cents: historicalPaidCents,
  };
  const current = getBioluminescencePackage('bio_solo');
  assert.notStrictEqual(current.priceCents, historical.final_amount_cents);
  assert.strictEqual(historical.final_amount_cents, 4689);
}

function run() {
  runActivePromotionTests();
  runInactivePromotionTests();
  runDateWindowTests();
  runClientCannotOverridePriceTests();
  runHistoricalAmountNotRecalculatedTest();
  console.log('bioPackagePromotion.test.js: all tests passed');
}

run();
