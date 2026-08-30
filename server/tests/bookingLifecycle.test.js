'use strict';

const assert = require('assert');
const { DateTime } = require('luxon');
const { buildPublicConfirmationSummary } = require('../lib/bookingLifecycle');

function run() {
  const start = DateTime.fromISO('2026-08-29T00:00', { zone: 'America/New_York' });
  const summary = buildPublicConfirmationSummary({
    booking: {
      id: 'efab338d-791a-4f23-af24-5a41ec25847c',
      booking_type: 'charter',
      charter_type: 'bio',
      start_time: start.toUTC().toISO(),
      end_time: start.plus({ hours: 1 }).toUTC().toISO(),
      guest_count: 2,
      deposit_paid: 89.99,
      waiver_signed: false,
    },
    customer: { email: 'guest@example.com' },
    boat: null,
  });

  assert.strictEqual(summary.reservationNumber, 'LZC-847C');
  assert.strictEqual(summary.durationLabel, '1 Hour');
  assert.strictEqual(summary.amountPaid, 89.99);
  assert.strictEqual(summary.guests, 2);
  assert.ok(summary.dateLabel.includes('August 29, 2026'), summary.dateLabel);
  assert.ok(summary.timeRange.includes('12:00 AM'), summary.timeRange);
  assert.strictEqual(summary.meeting.name, 'Parrish Park Boat Ramp');
  assert.ok(summary.meeting.mapsUrl.includes('google.com/maps/dir/'));
  console.log('bookingLifecycle.test.js: ok');
}

run();
