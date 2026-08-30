'use strict';

const assert = require('assert');
const {
  formatReservationNumber,
  parseReservationNumber,
  reservationNumberMatches,
} = require('../lib/reservationNumber');

function run() {
  const id = 'efab338d-791a-4f23-af24-5a41ec25847c';
  assert.strictEqual(formatReservationNumber(id), 'LZC-847C');
  assert.strictEqual(parseReservationNumber('lzc-847c'), 'LZC-847C');
  assert.strictEqual(parseReservationNumber('LZC-847C'), 'LZC-847C');
  assert.strictEqual(parseReservationNumber(id), null);
  assert.strictEqual(reservationNumberMatches(id, 'LZC-847C'), true);
  assert.strictEqual(reservationNumberMatches(id, '317-385-2938'), false);
  assert.strictEqual(formatReservationNumber('not-a-uuid'), null);
  console.log('reservationNumber.test.js: ok');
}

run();
