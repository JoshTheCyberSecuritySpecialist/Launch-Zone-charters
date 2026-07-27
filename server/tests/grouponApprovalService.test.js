const assert = require('node:assert/strict');
const test = require('node:test');
const {
  isGrouponPendingBooking,
  REJECT_REASONS,
} = require('../services/grouponApprovalConstants');
const { templateFor } = require('../services/bookingCommunications');

test('isGrouponPendingBooking identifies pending Groupon requests', () => {
  assert.equal(
    isGrouponPendingBooking({ booking_source: 'groupon', status: 'pending_verification' }),
    true
  );
  assert.equal(isGrouponPendingBooking({ booking_source: 'groupon', status: 'pending' }), true);
  assert.equal(isGrouponPendingBooking({ booking_source: 'groupon', status: 'confirmed' }), false);
  assert.equal(isGrouponPendingBooking({ booking_source: 'website', status: 'pending_verification' }), false);
});

test('REJECT_REASONS includes expected admin codes', () => {
  assert.ok(REJECT_REASONS.has('requested_time_unavailable'));
  assert.ok(REJECT_REASONS.has('voucher_issue'));
});

test('groupon rejection and proposal templates exist', () => {
  const booking = {
    id: '11111111-1111-1111-1111-111111111111',
    start_time: '2026-08-01T00:00:00.000Z',
    end_time: '2026-08-01T01:00:00.000Z',
    guest_count: 2,
    rental_location: 'port-orange',
    payment_status: 'paid',
    balance_due: 0,
    customers: { full_name: 'Alex Sample', email: 'alex@example.com', phone: '8035551212' },
    boats: { name: 'Pontoon A' },
  };
  const rejected = templateFor('groupon_request_rejected', { booking });
  const proposed = templateFor('groupon_alternative_proposed', { booking });
  assert.match(rejected.subject, /Update on your Groupon/i);
  assert.match(proposed.subject, /Alternate time proposed/i);
});
