const assert = require('node:assert/strict');
const test = require('node:test');
const { evaluateGrouponVoucherEligibility } = require('../services/grouponVoucherEligibilityService');
const { issueReservationSession, verifyReservationClientToken } = require('../services/grouponSessionToken');

const mapping = {
  id: 'map-1',
  active: true,
  booking_type: 'charter',
  charter_type: 'bio',
  rental_type: null,
  covered_guest_count: 2,
  service_label: 'Bio for 2',
};

const baseVoucher = {
  id: 'v1',
  voucher_last_four: 'AB12',
  owner_name: 'Alex Sample',
  source_status: 'Purchased',
  redeemed_flag: 'No',
  refunded_at: null,
  expires_at: '2099-12-31T04:59:00.000Z',
  local_status: 'available',
  booking_id: null,
  reserved_session_token: null,
  reserved_until: null,
  deal_name: 'Bio deal',
  option_name: 'Bio for 2',
};

test('evaluateGrouponVoucherEligibility accepts valid available voucher', () => {
  const result = evaluateGrouponVoucherEligibility(baseVoucher, mapping, { lastName: 'Sample' });
  assert.equal(result.eligible, true);
  assert.equal(result.coveredGuestCount, 2);
});

test('evaluateGrouponVoucherEligibility rejects wrong last name with generic message', () => {
  const result = evaluateGrouponVoucherEligibility(baseVoucher, mapping, { lastName: 'Wrong' });
  assert.equal(result.eligible, false);
  assert.match(result.customerMessage, /could not verify/i);
});

test('evaluateGrouponVoucherEligibility rejects refunded voucher', () => {
  const result = evaluateGrouponVoucherEligibility(
    { ...baseVoucher, source_status: 'Refunded', refunded_at: '2026-01-01T00:00:00.000Z' },
    mapping,
    { lastName: 'Sample' }
  );
  assert.equal(result.eligible, false);
  assert.match(result.customerMessage, /no longer available/i);
});

test('evaluateGrouponVoucherEligibility rejects guest count mismatch', () => {
  const result = evaluateGrouponVoucherEligibility(baseVoucher, mapping, {
    lastName: 'Sample',
    requestedGuestCount: 4,
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reasonCode, 'guest_mismatch');
});

test('evaluateGrouponVoucherEligibility rejects active reservation by another session', () => {
  const result = evaluateGrouponVoucherEligibility(
    {
      ...baseVoucher,
      local_status: 'reserved',
      reserved_session_token: 'other-session',
      reserved_until: '2099-12-31T04:59:00.000Z',
    },
    mapping,
    { lastName: 'Sample', sessionToken: 'my-session' }
  );
  assert.equal(result.eligible, false);
  assert.equal(result.reasonCode, 'reserved');
});

test('evaluateGrouponVoucherEligibility rejects voucher already linked to a booking', () => {
  const result = evaluateGrouponVoucherEligibility(
    { ...baseVoucher, booking_id: 'booking-123', local_status: 'reserved' },
    mapping,
    { lastName: 'Sample' }
  );
  assert.equal(result.eligible, false);
  assert.equal(result.reasonCode, 'already_booked');
});

test('evaluateGrouponVoucherEligibility allows voucher linked to same pending booking during approval', () => {
  const result = evaluateGrouponVoucherEligibility(
    { ...baseVoucher, booking_id: 'booking-123', local_status: 'reserved' },
    mapping,
    { allowLinkedBookingId: 'booking-123', requestedGuestCount: 2 }
  );
  assert.equal(result.eligible, true);
});

test('groupon session token verifies and rejects tampering', () => {
  const issued = issueReservationSession({
    voucherId: '11111111-1111-1111-1111-111111111111',
    sessionToken: 'abc123',
    ttlMs: 60_000,
  });
  const ok = verifyReservationClientToken(issued.clientToken);
  assert.equal(ok.ok, true);
  const tampered = verifyReservationClientToken(`${issued.clientToken}x`);
  assert.equal(tampered.ok, false);
});
