const assert = require('node:assert/strict');
const test = require('node:test');
const { templateFor } = require('../services/bookingCommunications');
const { formatTripWhen } = require('../services/grouponRequestNotifications');

test('groupon_request_received template says pending approval', () => {
  const preview = templateFor('groupon_request_received', {
    booking: {
      id: '11111111-1111-1111-1111-111111111111',
      start_time: '2026-08-01T00:00:00.000Z',
      end_time: '2026-08-01T01:00:00.000Z',
      guest_count: 4,
      rental_location: 'port-orange',
      payment_status: 'paid',
      balance_due: 0,
      customers: { full_name: 'Alex Sample', email: 'alex@example.com', phone: '8035551212' },
      boats: { name: 'Pontoon A' },
    },
  });
  assert.match(preview.subject, /awaiting approval/i);
  assert.match(preview.emailBody, /not confirmed yet/i);
  assert.match(preview.emailBody, /Do not arrive until you receive a confirmed reservation/i);
  assert.match(preview.smsBody, /Pending admin approval/i);
});

test('formatTripWhen returns readable label', () => {
  const label = formatTripWhen('2026-08-01T00:00:00.000Z');
  assert.match(label, /Jul|Aug/);
  assert.match(label, /at/i);
});
