'use strict';

const assert = require('assert');
const {
  isRentalBookingRow,
  isCharterBookingRow,
} = require('../services/rentalCleanupService');

function run() {
  assert.strictEqual(isCharterBookingRow({ booking_type: 'charter' }), true);
  assert.strictEqual(isRentalBookingRow({ booking_type: 'charter' }), false);
  assert.strictEqual(isRentalBookingRow({ booking_type: 'rental' }), true);
  assert.strictEqual(isRentalBookingRow({ booking_type: null }), true);
  console.log('rentalCleanupService.test: all assertions passed');
}

run();
