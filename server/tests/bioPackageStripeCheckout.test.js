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
  assert.strictEqual(stripeCentsFromPackageId('bio_solo'), 4000);
  assert.strictEqual(stripeCentsFromPackageId('bio_two'), 7800);
  assert.strictEqual(stripeCentsFromPackageId('bio_four'), 15000);

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
