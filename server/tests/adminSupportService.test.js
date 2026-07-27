const assert = require('node:assert/strict');
const test = require('node:test');
const { maskVoucherLastFour } = require('../services/grouponVoucherUtils');

function exceptionFromVoucher(voucher, mapping, reason, detail) {
  return {
    id: `${reason}:${voucher.id}`,
    reason,
    detail,
    voucherId: voucher.id,
    voucherMasked: maskVoucherLastFour(voucher.voucher_last_four),
    ownerName: voucher.owner_name,
    bookingId: voucher.booking_id,
    dealName: voucher.deal_name,
    optionName: voucher.option_name,
    sourceStatus: voucher.source_status,
    localStatus: voucher.local_status,
    serviceLabel: mapping?.service_label || null,
  };
}

test('exceptionFromVoucher builds stable queue id and masked voucher', () => {
  const row = exceptionFromVoucher(
    {
      id: 'v-1',
      voucher_last_four: 'AB12',
      owner_name: 'Alex Sample',
      booking_id: null,
      deal_name: 'Bio',
      option_name: 'Bio for 2',
      source_status: 'Purchased',
      local_status: 'available',
    },
    { service_label: 'Bio for 2' },
    'redeemed_without_booking',
    'Redeemed on import but not linked locally.'
  );
  assert.equal(row.id, 'redeemed_without_booking:v-1');
  assert.match(row.voucherMasked, /AB12/);
  assert.equal(row.reason, 'redeemed_without_booking');
});

test('bookingCommunications includes phase 3 support templates', () => {
  const bookingCommunications = require('../services/bookingCommunications');
  const detail = {
    booking: {
      id: '11111111-1111-1111-1111-111111111111',
      start_time: '2026-08-01T00:30:00.000Z',
      end_time: '2026-08-01T02:30:00.000Z',
      guest_count: 2,
      charter_type: 'bio',
      booking_type: 'charter',
      rental_location: 'daytona',
      customers: { full_name: 'Alex Sample', email: 'alex@example.com', phone: '5551234567' },
      boats: { name: 'Test Boat' },
    },
  };
  for (const type of [
    'weather_delay',
    'arrival_instructions',
    'passenger_weight_issue',
    'separate_trip_explanation',
    'groupon_support',
  ]) {
    const preview = bookingCommunications.templateFor(type, detail);
    assert.ok(preview.subject);
    assert.ok(preview.emailHtml);
    assert.ok(preview.smsBody);
  }
});
