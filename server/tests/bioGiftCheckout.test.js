process.env.DIRECT_BIO_PACKAGE_PRICING_ENABLED = 'true';

const assert = require('assert');
const {
  validateGiftCheckoutBody,
  generateGiftTicketCode,
  BIO_GIFT_MAX_TICKETS,
} = require('../services/bioGiftCheckout');

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`fail - ${name}`);
    throw err;
  }
}

const purchaser = {
  fullName: 'Jordan Purchaser',
  email: 'jordan@example.com',
  phone: '3215550100',
};

test('validates same-recipient multi-ticket purchase without a date', () => {
  const gift = validateGiftCheckoutBody({
    packageId: 'bio_solo',
    ticketQuantity: 3,
    recipientMode: 'same',
    recipientName: 'Alex Recipient',
    fromName: 'Jordan',
    giftMessage: 'Happy birthday',
    purchaser,
  });
  assert.strictEqual(gift.packageId, 'bio_solo');
  assert.strictEqual(gift.ticketQuantity, 3);
  assert.strictEqual(gift.recipientMode, 'same');
  assert.strictEqual(gift.tickets.length, 3);
  assert.strictEqual(gift.tickets[0].recipientName, 'Alex Recipient');
  assert.strictEqual(gift.tickets[2].recipientName, 'Alex Recipient');
  assert.strictEqual(gift.totalCents, gift.unitPriceCents * 3);
});

test('validates different recipients — one ticket record each', () => {
  const gift = validateGiftCheckoutBody({
    packageId: 'bio_two',
    ticketQuantity: 3,
    recipientMode: 'different',
    tickets: [
      { recipientName: 'Alex', fromName: 'Jordan', giftMessage: 'For Alex' },
      { recipientName: 'Blake', fromName: 'Jordan', recipientEmail: 'blake@example.com' },
      { recipientName: 'Casey', fromName: 'Sam' },
    ],
    purchaser,
  });
  assert.strictEqual(gift.recipientMode, 'different');
  assert.strictEqual(gift.tickets.length, 3);
  assert.strictEqual(gift.tickets[0].recipientName, 'Alex');
  assert.strictEqual(gift.tickets[1].recipientName, 'Blake');
  assert.strictEqual(gift.tickets[1].recipientEmail, 'blake@example.com');
  assert.strictEqual(gift.tickets[2].fromName, 'Sam');
  assert.strictEqual(gift.recipientName, 'Alex');
});

test('rejects different mode without full ticket list', () => {
  assert.throws(
    () =>
      validateGiftCheckoutBody({
        packageId: 'bio_two',
        ticketQuantity: 3,
        recipientMode: 'different',
        tickets: [{ recipientName: 'Alex', fromName: 'Jordan' }],
        purchaser,
      }),
    /each of the 3 gift tickets/
  );
});

test('rejects missing recipient on a ticket', () => {
  assert.throws(
    () =>
      validateGiftCheckoutBody({
        packageId: 'bio_two',
        ticketQuantity: 2,
        recipientMode: 'different',
        tickets: [
          { recipientName: 'Alex', fromName: 'Jordan' },
          { fromName: 'Jordan' },
        ],
        purchaser,
      }),
    /Ticket 2: recipient name/
  );
});

test('rejects over-max ticket quantity', () => {
  assert.throws(
    () =>
      validateGiftCheckoutBody({
        packageId: 'bio_two',
        ticketQuantity: BIO_GIFT_MAX_TICKETS + 1,
        recipientName: 'Alex',
        fromName: 'Jordan',
        purchaser,
      }),
    /Ticket quantity/
  );
});

test('generates unique LZC season ticket codes', () => {
  const a = generateGiftTicketCode(2027);
  const b = generateGiftTicketCode(2027);
  assert.match(a, /^LZC-2027-[0-9A-F]{8}$/);
  assert.match(b, /^LZC-2027-[0-9A-F]{8}$/);
  assert.notStrictEqual(a, b);
});

console.log('bioGiftCheckout tests passed');
