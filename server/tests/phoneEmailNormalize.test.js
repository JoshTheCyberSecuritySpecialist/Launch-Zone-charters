'use strict';

const assert = require('assert');
const { normalizeEmail, normalizePhoneDigits, phoneDigitsMatch } = require('../services/preTripSubmissionGuard');

function run() {
  const stored = '3173852938';
  assert.strictEqual(phoneDigitsMatch(stored, '3173852938'), true);
  assert.strictEqual(phoneDigitsMatch(stored, '317-385-2938'), true);
  assert.strictEqual(phoneDigitsMatch(stored, '(317) 385-2938'), true);
  assert.strictEqual(phoneDigitsMatch(stored, '+1 317 385 2938'), true);
  assert.strictEqual(phoneDigitsMatch(stored, '8035421761'), false);
  assert.strictEqual(normalizePhoneDigits('+1 317 385 2938'), '13173852938');

  assert.strictEqual(normalizeEmail('  Jamie@Example.COM '), 'jamie@example.com');
  assert.strictEqual(normalizeEmail('jamie@example.com'), 'jamie@example.com');
  console.log('phoneEmailNormalize.test.js: ok');
}

run();
