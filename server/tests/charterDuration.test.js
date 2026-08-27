'use strict';

const assert = require('assert');
const {
  DEFAULT_CAPTAIN_CHARTER_DURATION_MINUTES,
  formatCharterDurationLabel,
  formatCharterDurationTourLabel,
  normalizeCharterDurationMinutes,
  resolvePackageDurationMinutes,
} = require('../lib/charterDuration');

function run() {
  assert.strictEqual(DEFAULT_CAPTAIN_CHARTER_DURATION_MINUTES, 60);
  assert.strictEqual(formatCharterDurationLabel(60), '1 Hour');
  assert.strictEqual(formatCharterDurationLabel(90), '1.5 Hours');
  assert.strictEqual(formatCharterDurationLabel(120), '2 Hours');
  assert.strictEqual(formatCharterDurationTourLabel(60), '1 Hour Tour');
  assert.strictEqual(normalizeCharterDurationMinutes(null), 60);
  assert.strictEqual(resolvePackageDurationMinutes({ durationMinutes: 90 }), 90);
  assert.strictEqual(resolvePackageDurationMinutes(null), 60);
  console.log('charterDuration.test.js: all tests passed');
}

run();
