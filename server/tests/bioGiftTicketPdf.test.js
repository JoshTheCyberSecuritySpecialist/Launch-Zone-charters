process.env.DIRECT_BIO_PACKAGE_PRICING_ENABLED = 'true';
process.env.APP_PUBLIC_URL = 'https://launchzonecharters.com';

const assert = require('assert');
const {
  buildGiftTicketsPdfBuffer,
  normalizePaidTickets,
  redeemUrlForCode,
  formatValidSeasonLabel,
} = require('../services/bioGiftTicketPdf');

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`ok - ${name}`))
    .catch((err) => {
      console.error(`fail - ${name}`);
      throw err;
    });
}

const paidPayload = {
  kind: 'bio_gift',
  status: 'paid',
  packageId: 'bio_solo',
  packageName: 'Solo Bioluminescence Tour',
  seasonYear: 2027,
  seasonStart: '2027-06-01',
  seasonEnd: '2027-10-31',
  tickets: [
    {
      index: 1,
      code: 'LZC-2027-AABBCCDD',
      recipientName: 'Alex',
      fromName: 'Jordan',
      giftMessage: 'Happy birthday',
    },
    {
      index: 2,
      code: 'LZC-2027-EEFF0011',
      recipientName: 'Blake',
      fromName: 'Jordan',
      giftMessage: null,
    },
  ],
};

async function main() {
  await test('normalizes paid tickets', () => {
    const tickets = normalizePaidTickets(paidPayload);
    assert.strictEqual(tickets.length, 2);
    assert.strictEqual(tickets[0].code, 'LZC-2027-AABBCCDD');
  });

  await test('builds redeem URL', () => {
    assert.strictEqual(
      redeemUrlForCode('lzc-2027-aabbccdd'),
      'https://launchzonecharters.com/redeem/LZC-2027-AABBCCDD'
    );
  });

  await test('formats valid season label', () => {
    const label = formatValidSeasonLabel(paidPayload);
    assert.match(label, /2027/);
    assert.match(label, /June|6/);
  });

  await test('builds multi-page PDF buffer after payment payload', async () => {
    const buf = await buildGiftTicketsPdfBuffer(paidPayload);
    assert.ok(Buffer.isBuffer(buf));
    assert.ok(buf.length > 1000);
    assert.strictEqual(buf.slice(0, 4).toString('utf8'), '%PDF');
  });

  await test('filters PDF to a single ticket code', async () => {
    const buf = await buildGiftTicketsPdfBuffer(paidPayload, {
      ticketCode: 'LZC-2027-EEFF0011',
    });
    assert.ok(buf.length > 500);
    assert.strictEqual(buf.slice(0, 4).toString('utf8'), '%PDF');
  });

  console.log('bioGiftTicketPdf tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
