'use strict';

const assert = require('assert');
const {
  bookingRequirementsComplete,
  missingRequirementLabels,
} = require('../services/verificationReminder');
const { resolvePaidBookingStatus } = require('../lib/bookingLifecycle');

function run() {
  assert.strictEqual(
    resolvePaidBookingStatus({
      isCharterBooking: true,
      waiverAccepted: true,
      waiverSignature: 'Jamie Example',
    }),
    'confirmed'
  );

  assert.strictEqual(
    resolvePaidBookingStatus({
      isCharterBooking: false,
      waiverAccepted: true,
      waiverSignature: 'Jamie Example',
      captainIncluded: false,
      licenseStatus: 'verified',
      insuranceStatus: 'pending',
    }),
    'pending_verification'
  );

  assert.strictEqual(
    resolvePaidBookingStatus({
      isCharterBooking: false,
      waiverAccepted: true,
      waiverSignature: 'Jamie Example',
      captainIncluded: false,
      licenseStatus: 'verified',
      insuranceStatus: 'verified',
    }),
    'confirmed'
  );

  const charterComplete = {
    booking_type: 'charter',
    captain_included: true,
    waiver_signed: true,
    license_status: 'verified',
    insurance_status: 'verified',
  };
  assert.strictEqual(bookingRequirementsComplete(charterComplete), true);
  assert.deepStrictEqual(missingRequirementLabels(charterComplete), []);

  const rentalMissingInsurance = {
    booking_type: 'rental',
    captain_included: false,
    waiver_signed: true,
    license_status: 'verified',
    insurance_status: 'pending',
  };
  assert.strictEqual(bookingRequirementsComplete(rentalMissingInsurance), false);
  assert.ok(missingRequirementLabels(rentalMissingInsurance).includes('Buoy rental insurance'));

  console.log('bookingConfirmationFlow.test.js: ok');
}

run();
