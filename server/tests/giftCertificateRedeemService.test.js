const assert = require('assert');
const {
  normalizeGiftCode,
  publicGiftCertificateView,
  seasonForCertificate,
} = require('../services/giftCertificateRedeemHelpers');

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`fail - ${name}`);
    throw err;
  }
}

test('normalizes gift codes', () => {
  assert.strictEqual(normalizeGiftCode('  lzc-2027-aabbccdd  '), 'LZC-2027-AABBCCDD');
  assert.strictEqual(normalizeGiftCode('LZC 2027 AABB'), 'LZC2027AABB');
});

test('public view hides purchaser PII and flags redeemable', () => {
  const view = publicGiftCertificateView({
    gift_code: 'LZC-2027-AAAABBBB',
    status: 'active',
    package_id: 'bio_two',
    package_name: 'Bioluminescence Tour for Two',
    guest_count: 2,
    recipient_name: 'Alex',
    from_name: 'Jordan',
    gift_message: 'Have fun',
    season_year: 2027,
    valid_from: '2027-06-01',
    valid_until: '2027-10-31',
    purchaser_email: 'secret@example.com',
    purchaser_phone: '555-0100',
    redeemed_at: null,
  });
  assert.strictEqual(view.redeemable, true);
  assert.strictEqual(view.capacityConsumed, false);
  assert.strictEqual(view.guestCount, 2);
  assert.strictEqual(view.packageId, 'bio_two');
  assert.ok(!('purchaserEmail' in view));
  assert.ok(!JSON.stringify(view).includes('secret@example.com'));
});

test('redeemed certificates are not redeemable', () => {
  const view = publicGiftCertificateView({
    gift_code: 'LZC-2027-CCCCDDDD',
    status: 'redeemed',
    package_id: 'bio_solo',
    guest_count: 1,
    recipient_name: 'Blake',
    season_year: 2027,
    valid_from: '2027-06-01',
    valid_until: '2027-10-31',
    redeemed_at: '2027-07-01T00:00:00.000Z',
  });
  assert.strictEqual(view.redeemable, false);
  assert.strictEqual(view.capacityConsumed, true);
});

test('season window prefers certificate dates', () => {
  const season = seasonForCertificate({
    season_year: 2027,
    valid_from: '2027-06-15',
    valid_until: '2027-09-30',
  });
  assert.strictEqual(season.year, 2027);
  assert.strictEqual(season.bookingStart, '2027-06-15');
  assert.strictEqual(season.bookingEnd, '2027-09-30');
});

console.log('giftCertificateRedeemService tests passed');
