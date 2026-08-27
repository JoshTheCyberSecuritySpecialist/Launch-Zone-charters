'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const test = require('node:test');
const ack = require('../lib/damageFeeAcknowledgment');

test('charter products do not require the rental damage acknowledgment', () => {
  assert.equal(ack.requiresDamageFeeAcknowledgment({ bookingMode: 'charter' }), false);
  assert.equal(ack.requiresDamageFeeAcknowledgment({ bookingType: 'charter' }), false);
  assert.equal(ack.requiresDamageFeeAcknowledgment({ tripType: 'captain_charter' }), false);
  assert.equal(ack.damageFeeAcknowledgmentMissing({ bookingMode: 'charter', damageFeeAcknowledged: false }), false);
  assert.equal(ack.storedDamageFeeAcknowledged({ bookingMode: 'charter', damageFeeAcknowledged: true }), false);
});

test('rental products still require the damage acknowledgment', () => {
  assert.equal(ack.requiresDamageFeeAcknowledgment({ bookingMode: 'rental' }), true);
  assert.equal(ack.requiresDamageFeeAcknowledgment({ bookingType: 'rental' }), true);
  assert.equal(ack.requiresDamageFeeAcknowledgment({ tripType: 'pontoon_rental' }), true);
  assert.equal(ack.requiresDamageFeeAcknowledgment({}), true);
  assert.equal(ack.damageFeeAcknowledgmentMissing({ bookingMode: 'rental', damageFeeAcknowledged: false }), true);
  assert.equal(ack.damageFeeAcknowledgmentMissing({ bookingMode: 'rental', damageFeeAcknowledged: true }), false);
  assert.equal(ack.storedDamageFeeAcknowledged({ bookingMode: 'rental', damageFeeAcknowledged: true }), true);
});

test('shared rocket charter packages are classified as charter, not by display name', () => {
  assert.equal(
    ack.isCharterProduct({
      bookingMode: 'charter',
      bookingType: 'charter',
    }),
    true
  );
  assert.equal(ack.isCharterProduct({ bookingMode: 'Solo Rocket Launch Seat' }), false);
  assert.equal(ack.requiresDamageFeeAcknowledgment({ bookingMode: 'charter' }), false);
});

test('WaiverBlock hides the rental damage checkbox on charters and still requires a signature', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/components/booking/WaiverBlock.tsx'), 'utf8');
  assert.match(src, /bookingMode === 'rental' \? \(/);
  assert.match(src, /financially responsible for damage, prop strikes/);
  assert.match(src, /requiresDamageFeeAcknowledgment\(bookingMode\) && !damageFeeAcknowledged/);
  assert.match(src, /Electronic signature/);
  assert.match(src, /I have read and agree to the waiver terms above/);
});

test('BookNow omits damageFeeAcknowledged from charter Stripe checkout payloads', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/pages/BookNow.tsx'), 'utf8');
  assert.match(src, /\/api\/create-checkout-session/);
  assert.match(src, /\.\.\.\(bookingMode === 'rental' \? \{ damageFeeAcknowledged \} : \{\}\)/);
  assert.match(src, /waiverFormComplete\(\s*waiverData,\s*termsAccepted,\s*damageFeeAcknowledged,\s*bookingMode/);
});

test('create-checkout-session still requires Stripe payment and a waiver signature for charters', () => {
  const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.match(src, /app\.post\('\/api\/create-checkout-session'/);
  assert.match(src, /Stripe not configured/);
  assert.match(src, /Waiver acceptance and electronic signature are required to continue/);
  assert.match(src, /damageFeeAcknowledgment\.damageFeeAcknowledgmentMissing/);
  assert.match(src, /url: session\.url/);
});
