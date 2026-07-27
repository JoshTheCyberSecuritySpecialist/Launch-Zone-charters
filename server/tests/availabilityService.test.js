const assert = require('node:assert/strict');
const test = require('node:test');

function normalizeSlotRows(slots) {
  return (slots || []).map((slot) => ({
    startIso: slot.startIso || slot.start,
    endIso: slot.endIso || slot.end,
    label: slot.label,
    startHHMM: slot.startHHMM,
    available: slot.available !== false,
  }));
}

function rentalTripTypeForLocation(location) {
  const loc = String(location || 'port-orange').trim().toLowerCase();
  return loc === 'titusville' ? 'center_console_rental' : 'pontoon_rental';
}

test('normalizeSlotRows maps legacy start/end fields and defaults available=true', () => {
  const rows = normalizeSlotRows([
    { start: '2026-08-01T12:00:00.000Z', end: '2026-08-01T16:00:00.000Z', label: '8:00 AM' },
    { startIso: '2026-08-01T20:00:00.000Z', endIso: '2026-08-01T21:00:00.000Z', label: '4:00 PM', available: false },
  ]);
  assert.equal(rows[0].startIso, '2026-08-01T12:00:00.000Z');
  assert.equal(rows[0].available, true);
  assert.equal(rows[1].available, false);
});

test('rentalTripTypeForLocation maps port-orange to pontoon and titusville to center console', () => {
  assert.equal(rentalTripTypeForLocation('port-orange'), 'pontoon_rental');
  assert.equal(rentalTripTypeForLocation('Port Orange'), 'pontoon_rental');
  assert.equal(rentalTripTypeForLocation('titusville'), 'center_console_rental');
});

test('groupon eligibility accepts pontoon rental mapping request', () => {
  const { evaluateGrouponVoucherEligibility } = require('../services/grouponVoucherEligibilityService');
  const mapping = {
    id: 'map-pontoon',
    active: true,
    booking_type: 'rental',
    charter_type: null,
    rental_type: 'half_day',
    rental_location: 'port-orange',
    covered_guest_count: 6,
    service_label: 'Port Orange 4-hour pontoon rental',
  };
  const voucher = {
    id: 'v2',
    voucher_last_four: 'CD34',
    owner_name: 'Jamie Example',
    source_status: 'Purchased',
    redeemed_flag: 'No',
    refunded_at: null,
    expires_at: '2099-12-31T04:59:00.000Z',
    local_status: 'available',
    booking_id: null,
    reserved_session_token: null,
    reserved_until: null,
  };
  const result = evaluateGrouponVoucherEligibility(voucher, mapping, {
    lastName: 'Example',
    request: { bookingType: 'rental', rentalType: 'half_day' },
  });
  assert.equal(result.eligible, true);
  assert.equal(result.coveredGuestCount, 6);
});
