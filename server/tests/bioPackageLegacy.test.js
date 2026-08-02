'use strict';

const assert = require('assert');
const path = require('path');

function loadPackagesModule() {
  const resolved = require.resolve('../config/bioluminescencePackages');
  delete require.cache[resolved];
  return require('../config/bioluminescencePackages');
}

function loadPricingModule() {
  const resolved = require.resolve('../services/bioluminescencePackagePricing');
  delete require.cache[resolved];
  return require('../services/bioluminescencePackagePricing');
}

function runFeatureFlagTests() {
  delete process.env.DIRECT_BIO_PACKAGE_PRICING_ENABLED;
  assert.strictEqual(loadPackagesModule().isDirectBioPackagePricingEnabled(), false);

  process.env.DIRECT_BIO_PACKAGE_PRICING_ENABLED = '';
  assert.strictEqual(loadPackagesModule().isDirectBioPackagePricingEnabled(), false);

  process.env.DIRECT_BIO_PACKAGE_PRICING_ENABLED = 'false';
  assert.strictEqual(loadPackagesModule().isDirectBioPackagePricingEnabled(), false);

  process.env.DIRECT_BIO_PACKAGE_PRICING_ENABLED = 'true';
  assert.strictEqual(loadPackagesModule().isDirectBioPackagePricingEnabled(), true);
}

function runLegacyCheckoutFallbackTests() {
  process.env.DIRECT_BIO_PACKAGE_PRICING_ENABLED = 'false';
  const { validateDirectBioPackageCheckout } = loadPricingModule();
  const legacy = validateDirectBioPackageCheckout({
    charterType: 'bio',
    pricingPackageId: '',
    passengerCountFromClient: 3,
    bookingSource: 'website',
  });
  assert.strictEqual(legacy.ok, true);
  assert.strictEqual(legacy.useLegacy, true);

  process.env.DIRECT_BIO_PACKAGE_PRICING_ENABLED = 'true';
  const required = validateDirectBioPackageCheckout({
    charterType: 'bio',
    pricingPackageId: '',
    passengerCountFromClient: 1,
    bookingSource: 'website',
  });
  assert.strictEqual(required.ok, false);
}

function runLegacyConfirmationTemplateTest() {
  const { templateFor } = require('../services/bookingCommunications');
  const detail = {
    booking: {
      id: '00000000-0000-4000-8000-000000000001',
      charter_type: 'bio',
      pricing_package_id: null,
      pricing_package_name: null,
      guest_count: 2,
      start_time: '2026-08-01T01:00:00.000Z',
      end_time: '2026-08-01T02:00:00.000Z',
      total_price: 300,
      final_total: 300,
      payment_status: 'paid',
      balance_due: 0,
      rental_location: 'Titusville',
      customers: { full_name: 'Legacy Guest', email: 'legacy@example.com', phone: '8035421761' },
      boats: { name: 'Lagoon Boat' },
    },
  };
  const tpl = templateFor('booking_confirmation', detail);
  assert.ok(tpl.emailBody.includes('Legacy bioluminescence pricing'), 'legacy package line in email');
  assert.ok(tpl.smsBody.length > 0, 'SMS body renders');
  assert.ok(!tpl.emailBody.includes('bio_solo'), 'no retroactive package id');
}

function runFlagMismatchTests() {
  process.env.DIRECT_BIO_PACKAGE_PRICING_ENABLED = 'false';
  const { assertBioPackageRequestAllowed } = loadPricingModule();
  const blocked = assertBioPackageRequestAllowed({
    pricingPackageId: 'bio_solo',
    charterType: 'bio',
    bookingMode: 'charter',
  });
  assert.strictEqual(blocked.ok, false);
  assert.strictEqual(blocked.code, 'bio_package_pricing_unavailable');
  assert.strictEqual(blocked.statusCode, 503);

  const rocket = assertBioPackageRequestAllowed({
    pricingPackageId: 'bio_solo',
    charterType: 'rocket',
    bookingMode: 'charter',
  });
  assert.strictEqual(rocket.ok, false);
  assert.strictEqual(rocket.code, 'bio_package_invalid_context');
}

function run() {
  runFeatureFlagTests();
  runLegacyCheckoutFallbackTests();
  runLegacyConfirmationTemplateTest();
  runFlagMismatchTests();
  console.log('bioPackageLegacy.test.js: all tests passed');
}

run();
