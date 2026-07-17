const assert = require('node:assert/strict');
const test = require('node:test');
const waiverPdfService = require('../services/waiverPdfService');

test('buildSignedWaiverPdf returns a non-empty PDF buffer', async () => {
  const buffer = await waiverPdfService.buildSignedWaiverPdf({
    context: 'booking',
    recordId: '11111111-1111-1111-1111-111111111111',
    customerName: 'Jane Example',
    customerEmail: 'jane@example.com',
    signatureText: 'Jane Example',
    signedAt: '2026-07-16T12:00:00.000Z',
    ipAddress: '203.0.113.10',
    waiverContent: 'Florida Boating Liability Waiver accepted.',
    termsAccepted: true,
    damageFeeAcknowledged: true,
    waiverAccepted: true,
    source: 'Waivers & insurance page',
    tripType: null,
  });
  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 500);
  assert.equal(buffer.slice(0, 4).toString(), '%PDF');
});

test('waiverPdfFileName sanitizes customer name', () => {
  assert.match(
    waiverPdfService.waiverPdfFileName({
      context: 'pre_trip',
      customerName: 'John / Doe',
      recordId: '22222222-2222-2222-2222-222222222222',
    }),
    /^signed-waiver-pre_trip-John-Doe\.pdf$/
  );
});
