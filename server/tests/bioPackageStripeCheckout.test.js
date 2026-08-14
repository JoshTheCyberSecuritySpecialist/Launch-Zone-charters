'use strict';

process.env.DIRECT_BIO_PACKAGE_PRICING_ENABLED = 'true';

const assert = require('assert');
const { getBioluminescencePackage } = require('../config/bioluminescencePackages');
const {
  bioPackageExpectedTotals,
  stripeLineItemNameForBioPackage,
  validateDirectBioPackageCheckout,
} = require('../services/bioluminescencePackagePricing');

function stripeCentsFromPackageId(id) {
  const pkg = getBioluminescencePackage(id);
  const totals = bioPackageExpectedTotals(pkg);
  return Math.round(totals.amountDueToday * 100);
}

function run() {
  assert.strictEqual(stripeCentsFromPackageId('bio_solo'), 5850);
  assert.strictEqual(stripeCentsFromPackageId('bio_two'), 12000);
  assert.strictEqual(stripeCentsFromPackageId('bio_four'), 24000);

  const twoPkg = getBioluminescencePackage('bio_two');
  const twoTotals = bioPackageExpectedTotals(twoPkg);
  assert.strictEqual(Math.round(twoTotals.amountDueToday * 100), 12000);
  assert.strictEqual(twoPkg.priceCents, 12000);

  const solo = getBioluminescencePackage('bio_solo');
  assert.match(stripeLineItemNameForBioPackage(solo), /1 Guest/);

  const tampered = validateDirectBioPackageCheckout({
    charterType: 'bio',
    pricingPackageId: 'bio_four',
    passengerCountFromClient: 1,
    bookingSource: 'website',
  });
  assert.strictEqual(tampered.ok, false);

  const grouponPkg = validateDirectBioPackageCheckout({
    charterType: 'bio',
    pricingPackageId: 'bio_solo',
    passengerCountFromClient: 1,
    bookingSource: 'groupon',
  });
  assert.strictEqual(grouponPkg.ok, true);
  assert.strictEqual(grouponPkg.skipPackage, true);

  console.log('bioPackageStripeCheckout.test.js: all tests passed');
}

run();
