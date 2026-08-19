const assert = require('assert');
const { DateTime } = require('luxon');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.BUSINESS_TIMEZONE = 'America/New_York';
process.env.ROCKET_PRE_LAUNCH_BUFFER_MINUTES = '60';
process.env.ROCKET_CHARTER_DURATION_HOURS = '1';

const rocketScheduleService = require('../services/rocketScheduleService');
const rocketLaunchAvailability = require('../services/rocketLaunchAvailabilityService');
const availabilityService = require('../services/availabilityService');

function mockLaunch(id, name, netIso) {
  return {
    id,
    name,
    net: netIso,
    status: { name: 'Go' },
    pad: { name: 'LC-39A' },
    launch_service_provider: { name: 'SpaceX' },
  };
}

async function run() {
  const zone = 'America/New_York';

  const cases = [
    {
      label: 'morning',
      net: '2026-08-20T12:00:00.000Z', // 8:00 AM EDT
      expectDepartureLocal: '2026-08-20T07:00',
      calendarDate: '2026-08-20',
    },
    {
      label: 'afternoon',
      net: '2026-08-21T18:30:00.000Z', // 2:30 PM EDT
      expectDepartureLocal: '2026-08-21T13:30',
      calendarDate: '2026-08-21',
    },
    {
      label: 'evening',
      net: '2026-08-22T23:00:00.000Z', // 7:00 PM EDT
      expectDepartureLocal: '2026-08-22T18:00',
      calendarDate: '2026-08-22',
    },
    {
      label: 'night',
      net: '2026-08-23T03:30:00.000Z', // 11:30 PM EDT on Aug 22
      expectDepartureLocal: '2026-08-22T22:30',
      calendarDate: '2026-08-22',
    },
    {
      label: 'after_midnight',
      net: '2026-08-28T05:30:00.000Z', // 1:30 AM EDT on Aug 28
      expectDepartureLocal: '2026-08-28T00:30',
      calendarDate: '2026-08-28',
    },
  ];

  for (const testCase of cases) {
    const launch = mockLaunch(`launch-${testCase.label}`, `${testCase.label} launch`, testCase.net);
    const window = rocketLaunchAvailability.computeRocketCharterWindowFromNet(testCase.net);
    assert.ok(window, `${testCase.label}: window computed`);
    assert.strictEqual(window.launchCalendarDate, testCase.calendarDate, `${testCase.label}: calendar date`);

    const departureLocal = DateTime.fromISO(window.departureStartIso, { zone: 'utc' })
      .setZone(zone)
      .toFormat("yyyy-MM-dd'T'HH:mm");
    assert.strictEqual(departureLocal, testCase.expectDepartureLocal, `${testCase.label}: departure local`);

    const validation = rocketLaunchAvailability.validateRocketLaunchSlotAgainstLaunch(
      launch,
      window.departureStartIso,
      window.departureEndIso,
      { minBookableStartMs: 0 }
    );
    assert.strictEqual(validation.valid, true, `${testCase.label}: validates`);
  }

  rocketScheduleService.setLaunchCacheForTests(cases.map((c, i) => mockLaunch(`id-${i}`, c.label, c.net)));

  const cachedLaunches = await rocketScheduleService.getLaunches();
  const aug20Candidates = rocketLaunchAvailability.candidateSlotsForLaunchesOnDate(
    cachedLaunches,
    '2026-08-20'
  );
  assert.strictEqual(aug20Candidates.length, 1, 'morning launch appears on launch calendar date');

  const aug28Candidates = rocketLaunchAvailability.candidateSlotsForLaunchesOnDate(
    cachedLaunches,
    '2026-08-28'
  );
  assert.strictEqual(aug28Candidates.length, 1, 'after-midnight launch stays on Aug 28 calendar date');

  const validate = (charterType, startLocal, endLocal) =>
    availabilityService.validateCharterSlotWindow({
      charterType,
      startIso: DateTime.fromISO(startLocal, { zone }).toUTC().toISO(),
      endIso: DateTime.fromISO(endLocal, { zone }).toUTC().toISO(),
    });

  assert.strictEqual(validate('bio', '2026-01-02T20:00', '2026-01-02T21:00').valid, true);
  assert.strictEqual(validate('bio', '2026-01-02T17:00', '2026-01-02T18:00').valid, false);

  assert.strictEqual(validate('rocket', '2026-01-02T08:00', '2026-01-02T09:00').valid, true);
  assert.strictEqual(validate('rocket', '2026-01-02T14:30', '2026-01-02T15:30').valid, true);
  assert.strictEqual(validate('rocket', '2026-01-02T20:00', '2026-01-02T21:00').valid, true);
  assert.strictEqual(validate('rocket', '2026-01-03T01:30', '2026-01-03T02:30').valid, true);

  const friday = DateTime.fromISO('2026-01-02', { zone });
  const bioStarts = availabilityService.enumerateCharterStartsForDay(friday, 'bio');
  const rocketStarts = availabilityService.enumerateCharterStartsForDay(friday, 'rocket');
  assert.ok(bioStarts.some((dt) => dt.hour === 20), 'bio includes 8 PM');
  assert.ok(!bioStarts.some((dt) => dt.hour === 8), 'bio excludes 8 AM');
  assert.ok(rocketStarts.some((dt) => dt.hour === 17), 'legacy rocket enumerate still has daytime hours');
  assert.ok(!rocketStarts.some((dt) => dt.hour === 0), 'legacy rocket enumerate is not bio midnight set');

  const bioHours = new Set(bioStarts.map((dt) => dt.hour));
  const rocketHours = new Set(rocketStarts.map((dt) => dt.hour));
  assert.ok(bioHours.has(0) && bioHours.has(4), 'bio includes after-midnight charter hours');
  assert.ok(!rocketHours.has(0) && !rocketHours.has(3), 'rocket legacy enumerate is not bio night-only');
  assert.ok(rocketHours.has(17), 'rocket legacy enumerate still allows daytime hours');

  rocketScheduleService.clearLaunchCacheForTests();
  console.log('rocketLaunchAvailability.test: all assertions passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
