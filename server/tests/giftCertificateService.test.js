const assert = require('assert');
const {
  payloadFromGiftCertificateRows,
  guestCountForPackage,
  isMissingGiftCertificatesTable,
} = require('../services/giftCertificateService');

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`fail - ${name}`);
    throw err;
  }
}

test('maps gift_certificates rows to gift payload shape', () => {
  const payload = payloadFromGiftCertificateRows(
    [
      {
        id: 'a',
        gift_code: 'LZC-2027-AAAABBBB',
        ticket_index: 1,
        recipient_name: 'Alex',
        from_name: 'Jordan',
        gift_message: 'Hi',
        package_id: 'bio_solo',
        package_name: 'Solo Bioluminescence Tour',
        guest_count: 1,
        original_value_cents: 4499,
        amount_paid_cents: 4499,
        season_year: 2027,
        valid_from: '2027-06-01',
        valid_until: '2027-10-31',
        recipient_mode: 'different',
        purchaser_name: 'Jordan Purchaser',
        purchaser_email: 'jordan@example.com',
        status: 'active',
      },
      {
        id: 'b',
        gift_code: 'LZC-2027-CCCCDDDD',
        ticket_index: 2,
        recipient_name: 'Blake',
        from_name: 'Jordan',
        package_id: 'bio_solo',
        package_name: 'Solo Bioluminescence Tour',
        guest_count: 1,
        original_value_cents: 4499,
        amount_paid_cents: 4499,
        season_year: 2027,
        valid_from: '2027-06-01',
        valid_until: '2027-10-31',
        recipient_mode: 'different',
        purchaser_email: 'jordan@example.com',
        status: 'active',
      },
    ],
    'cs_test_123'
  );

  assert.strictEqual(payload.kind, 'bio_gift');
  assert.strictEqual(payload.status, 'paid');
  assert.strictEqual(payload.ticketQuantity, 2);
  assert.strictEqual(payload.recipientMode, 'different');
  assert.strictEqual(payload.tickets[0].code, 'LZC-2027-AAAABBBB');
  assert.strictEqual(payload.tickets[1].recipientName, 'Blake');
  assert.strictEqual(payload.totalCents, 8998);
  assert.strictEqual(payload.capacityConsumed, false);
  assert.strictEqual(payload.source, 'gift_certificates');
});

test('guestCountForPackage handles private', () => {
  assert.strictEqual(guestCountForPackage({ id: 'bio_private', maxGuests: 5, guestCount: 1 }), 5);
  assert.strictEqual(guestCountForPackage({ id: 'bio_two', guestCount: 2 }), 2);
});

test('detects missing-table errors', () => {
  assert.strictEqual(
    isMissingGiftCertificatesTable({ code: 'PGRST205', message: 'Could not find the table' }),
    true
  );
  assert.strictEqual(isMissingGiftCertificatesTable({ message: 'other error' }), false);
});

console.log('giftCertificateService tests passed');
