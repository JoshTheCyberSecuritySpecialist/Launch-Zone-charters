const assert = require('assert');
process.env.DIRECT_BIO_PACKAGE_PRICING_ENABLED =
  process.env.DIRECT_BIO_PACKAGE_PRICING_ENABLED || 'true';

const {
  adminRowView,
  giftPlatformSettings,
  isGiftSalesEnabled,
  isGiftStorefrontOpen,
  ADMIN_STATUS_FILTERS,
} = require('../services/giftCertificateAdminService');

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`fail - ${name}`);
    throw err;
  }
}

test('maps admin row view', () => {
  const view = adminRowView({
    id: 'uuid-1',
    gift_code: 'LZC-2027-AAAABBBB',
    status: 'active',
    package_id: 'bio_solo',
    package_name: 'Solo',
    guest_count: 1,
    recipient_name: 'Alex',
    purchaser_email: 'a@example.com',
    amount_paid_cents: 4499,
    original_value_cents: 4499,
    season_year: 2027,
    valid_from: '2027-06-01',
    valid_until: '2027-10-31',
    ticket_index: 1,
    recipient_mode: 'same',
    stripe_checkout_session_id: 'cs_test',
    redeemed_booking_id: null,
    redeemed_at: null,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
  });
  assert.strictEqual(view.giftCode, 'LZC-2027-AAAABBBB');
  assert.strictEqual(view.amountPaidCents, 4499);
  assert.strictEqual(view.purchaserEmail, 'a@example.com');
  assert.ok(ADMIN_STATUS_FILTERS.includes('active'));
});

test('gift sales default disabled until explicitly true', () => {
  const prev = process.env.BIO_GIFT_SALES_ENABLED;
  delete process.env.BIO_GIFT_SALES_ENABLED;
  assert.strictEqual(isGiftSalesEnabled(), false);
  process.env.BIO_GIFT_SALES_ENABLED = 'false';
  assert.strictEqual(isGiftSalesEnabled(), false);
  process.env.BIO_GIFT_SALES_ENABLED = 'true';
  assert.strictEqual(isGiftSalesEnabled(), true);
  process.env.BIO_GIFT_SALES_ENABLED = 'yes';
  assert.strictEqual(isGiftSalesEnabled(), false);
  if (prev === undefined) delete process.env.BIO_GIFT_SALES_ENABLED;
  else process.env.BIO_GIFT_SALES_ENABLED = prev;
});

test('settings expose 2027 season', () => {
  const settings = giftPlatformSettings();
  assert.ok(Array.isArray(settings.seasons));
  assert.ok(settings.seasons.some((s) => s.year === 2027));
  assert.strictEqual(settings.giftSalesEnv, 'BIO_GIFT_SALES_ENABLED');
});

test('storefront open requires sales flag and package pricing', () => {
  const prevSales = process.env.BIO_GIFT_SALES_ENABLED;
  const prevPkg = process.env.DIRECT_BIO_PACKAGE_PRICING_ENABLED;
  process.env.BIO_GIFT_SALES_ENABLED = 'true';
  process.env.DIRECT_BIO_PACKAGE_PRICING_ENABLED = 'true';
  assert.strictEqual(isGiftStorefrontOpen(), true);
  process.env.BIO_GIFT_SALES_ENABLED = 'false';
  assert.strictEqual(isGiftStorefrontOpen(), false);
  if (prevSales === undefined) delete process.env.BIO_GIFT_SALES_ENABLED;
  else process.env.BIO_GIFT_SALES_ENABLED = prevSales;
  if (prevPkg === undefined) delete process.env.DIRECT_BIO_PACKAGE_PRICING_ENABLED;
  else process.env.DIRECT_BIO_PACKAGE_PRICING_ENABLED = prevPkg;
});

console.log('giftCertificateAdminService tests passed');
