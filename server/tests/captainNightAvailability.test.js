const assert = require('assert');
const { DateTime } = require('luxon');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const availabilityService = require('../services/availabilityService');

function run() {
  const zone = availabilityService.BUSINESS_TZ;

  const validate = (charterType, startLocal, endLocal) =>
    availabilityService.validateCharterSlotWindow({
      charterType,
      startIso: DateTime.fromISO(startLocal, { zone }).toUTC().toISO(),
      endIso: DateTime.fromISO(endLocal, { zone }).toUTC().toISO(),
    });

  assert.strictEqual(validate('bio', '2026-01-02T20:00', '2026-01-02T21:00').valid, true);
  assert.strictEqual(validate('bio', '2026-01-03T02:00', '2026-01-03T03:00').valid, true);
  assert.strictEqual(validate('rocket', '2026-01-02T17:00', '2026-01-02T18:00').valid, true);
  assert.strictEqual(validate('rocket', '2026-01-03T21:00', '2026-01-03T22:00').valid, true);

  assert.strictEqual(validate('rocket', '2026-01-01T18:00', '2026-01-01T19:00').valid, false);
  assert.strictEqual(validate('rocket', '2026-01-04T18:00', '2026-01-04T19:00').valid, false);
  assert.strictEqual(validate('bio', '2026-01-02T19:00', '2026-01-02T20:00').valid, false);
  assert.strictEqual(validate('rocket', '2026-01-02T02:00', '2026-01-02T03:00').valid, false);

  const friday = DateTime.fromISO('2026-01-02', { zone });
  const starts = availabilityService.enumerateCharterStartsForDay(friday, 'rocket');
  assert.ok(starts.some((dt) => dt.hour === 17));
  assert.ok(!starts.some((dt) => dt.hour === 9));

  console.log('captainNightAvailability.test: all assertions passed');
}

run();
