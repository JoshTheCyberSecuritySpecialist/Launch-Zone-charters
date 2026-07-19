const assert = require('assert');
const { DateTime } = require('luxon');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const availabilityService = require('../services/availabilityService');
const bookingDateTimeRange = require('../lib/bookingDateTimeRange');

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

  assert.strictEqual(validate('rocket', '2026-01-01T18:00', '2026-01-01T19:00').valid, true);
  assert.strictEqual(validate('rocket', '2026-01-04T18:00', '2026-01-04T19:00').valid, true);
  assert.strictEqual(validate('bio', '2026-01-02T19:00', '2026-01-02T20:00').valid, false);
  assert.strictEqual(validate('rocket', '2026-01-02T02:00', '2026-01-02T03:00').valid, false);

  const staff = (startLocal, endLocal) => validate('captain_charter', startLocal, endLocal);

  assert.strictEqual(staff('2026-01-02T17:00', '2026-01-02T18:00').valid, true);
  assert.strictEqual(staff('2026-01-02T23:00', '2026-01-03T00:00').valid, true);
  assert.strictEqual(staff('2026-01-02T23:30', '2026-01-03T01:30').valid, true);
  assert.strictEqual(staff('2026-01-03T00:30', '2026-01-03T02:30').valid, true);
  assert.strictEqual(staff('2026-01-03T17:00', '2026-01-03T20:00').valid, true);
  assert.strictEqual(staff('2026-01-03T23:00', '2026-01-04T02:00').valid, true);
  assert.strictEqual(staff('2026-01-04T00:00', '2026-01-04T04:00').valid, true);

  assert.strictEqual(staff('2026-01-02T16:00', '2026-01-02T17:00').valid, false);
  assert.strictEqual(staff('2026-01-03T04:30', '2026-01-03T05:30').valid, false);
  assert.strictEqual(staff('2026-01-04T17:00', '2026-01-04T18:00').valid, true);
  assert.strictEqual(staff('2026-01-05T18:00', '2026-01-05T19:00').valid, true);
  assert.strictEqual(staff('2026-01-01T18:00', '2026-01-01T19:00').valid, true);
  assert.strictEqual(staff('2026-01-02T23:00', '2026-01-03T05:00').valid, false);

  const overnightDuration = bookingDateTimeRange.resolveBookingRangeFromBody({
    date: '2026-01-02',
    startTime: '23:00',
    duration_hours: 1,
  });
  assert.strictEqual(overnightDuration.ok, true);
  const overnightWindow = validate(
    'captain_charter',
    DateTime.fromISO(overnightDuration.startIso, { zone: 'utc' }).setZone(zone).toFormat("yyyy-MM-dd'T'HH:mm"),
    DateTime.fromISO(overnightDuration.endIso, { zone: 'utc' }).setZone(zone).toFormat("yyyy-MM-dd'T'HH:mm")
  );
  assert.strictEqual(overnightWindow.valid, true);

  const friday = DateTime.fromISO('2026-01-02', { zone });
  const starts = availabilityService.enumerateCharterStartsForDay(friday, 'rocket');
  assert.ok(starts.some((dt) => dt.hour === 17));
  assert.ok(!starts.some((dt) => dt.hour === 9));

  console.log('captainNightAvailability.test: all assertions passed');
}

run();
