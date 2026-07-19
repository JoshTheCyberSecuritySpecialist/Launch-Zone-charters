const assert = require('assert');
const { DateTime } = require('luxon');

const {
  BUSINESS_TZ,
  END_BEFORE_START_MESSAGE,
  MISSING_TIME_MESSAGE,
  bookingFormTimesFromIso,
  normalizeClockTime,
  resolveBookingDateTimeRange,
  resolveBookingRangeFromBody,
  resolveBookingRangeFromDuration,
} = require('../lib/bookingDateTimeRange');

const zone = BUSINESS_TZ;

function run() {
  assert.strictEqual(normalizeClockTime('23:00'), '23:00');
  assert.strictEqual(normalizeClockTime('11:00 PM'), '23:00');
  assert.strictEqual(normalizeClockTime('12:00 AM'), '00:00');

  const overnight = resolveBookingDateTimeRange({
    date: '2026-07-19',
    startTime: '23:00',
    endTime: '00:00',
    timeZone: zone,
  });
  assert.strictEqual(overnight.ok, true);
  assert.strictEqual(overnight.crossesMidnight, true);
  assert.strictEqual(overnight.durationMinutes, 60);
  assert.strictEqual(overnight.durationHours, 1);

  const twoHour = resolveBookingDateTimeRange({
    date: '2026-07-19',
    startTime: '23:00',
    endTime: '01:00',
    timeZone: zone,
  });
  assert.strictEqual(twoHour.ok, true);
  assert.strictEqual(twoHour.durationMinutes, 120);

  const sameDay = resolveBookingDateTimeRange({
    date: '2026-07-19',
    startTime: '09:00',
    endTime: '13:00',
    timeZone: zone,
  });
  assert.strictEqual(sameDay.ok, true);
  assert.strictEqual(sameDay.crossesMidnight, false);
  assert.strictEqual(sameDay.durationHours, 4);

  const equal = resolveBookingDateTimeRange({
    date: '2026-07-19',
    startTime: '10:00',
    endTime: '10:00',
    timeZone: zone,
  });
  assert.strictEqual(equal.ok, false);
  assert.strictEqual(equal.error, END_BEFORE_START_MESSAGE);

  const missing = resolveBookingDateTimeRange({ date: '', startTime: '10:00', endTime: '11:00', timeZone: zone });
  assert.strictEqual(missing.ok, false);
  assert.strictEqual(missing.error, MISSING_TIME_MESSAGE);

  const fromDuration = resolveBookingRangeFromDuration({
    date: '2026-07-19',
    startTime: '23:00',
    durationHours: 2,
    timeZone: zone,
  });
  assert.strictEqual(fromDuration.ok, true);
  assert.strictEqual(fromDuration.crossesMidnight, true);
  assert.strictEqual(fromDuration.durationMinutes, 120);

  const bodyLocal = resolveBookingRangeFromBody({
    date: '2026-07-19',
    start_time_local: '23:00',
    end_time_local: '00:30',
  });
  assert.strictEqual(bodyLocal.ok, true);
  assert.strictEqual(bodyLocal.durationMinutes, 90);

  const bodyDuration = resolveBookingRangeFromBody({
    date: '2026-07-19',
    startTime: '14:00',
    duration_hours: 3,
  });
  assert.strictEqual(bodyDuration.ok, true);
  assert.strictEqual(bodyDuration.durationHours, 3);

  const startIso = overnight.startIso;
  const endIso = overnight.endIso;
  const formTimes = bookingFormTimesFromIso(startIso, endIso, zone);
  assert.strictEqual(formTimes.date, '2026-07-19');
  assert.strictEqual(formTimes.startTime, '23:00');
  assert.strictEqual(formTimes.endTime, '00:00');
  assert.strictEqual(formTimes.crossesMidnight, true);

  // DST spring forward: 2026-03-08 2:00 AM does not exist in America/New_York
  const dst = resolveBookingDateTimeRange({
    date: '2026-03-08',
    startTime: '01:30',
    endTime: '03:30',
    timeZone: zone,
  });
  assert.strictEqual(dst.ok, true);
  const startLocal = DateTime.fromISO(dst.startIso, { zone: 'utc' }).setZone(zone);
  const endLocal = DateTime.fromISO(dst.endIso, { zone: 'utc' }).setZone(zone);
  assert.ok(endLocal > startLocal);
  assert.ok(dst.durationMinutes >= 60);

  console.log('bookingDateTimeRange.test: all assertions passed');
}

run();
