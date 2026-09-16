'use strict';

/**
 * Regression: open bio nights must expose the full 8 PM→4 AM hourly grid
 * (America/New_York), without previous-night midnight pollution or empty-night
 * fill-forward collapsing the list to a single start.
 */
const assert = require('assert');
const { DateTime } = require('luxon');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.BUSINESS_TIMEZONE = process.env.BUSINESS_TIMEZONE || 'America/New_York';

const availabilityService = require('../services/availabilityService');
const {
  applyBioSharedFillForward,
  selectFillForwardTarget,
} = require('../services/bioSharedFillForward');

const ZONE = 'America/New_York';

function slot(localStart, capacity) {
  const start = DateTime.fromISO(localStart, { zone: ZONE });
  const end = start.plus({ hours: 1 });
  return {
    start: start.toUTC().toISO(),
    end: end.toUTC().toISO(),
    startIso: start.toUTC().toISO(),
    endIso: end.toUTC().toISO(),
    label: start.toFormat('h:mm a'),
    startHHMM: start.toFormat('HH:mm'),
    available: true,
    capacity: {
      max: capacity.max,
      used: capacity.used,
      remaining: capacity.remaining,
      fleetUsed: capacity.fleetUsed ?? capacity.used,
      requested: 1,
    },
  };
}

function run() {
  const friday = DateTime.fromObject({ year: 2026, month: 9, day: 25 }, { zone: ZONE }).startOf('day');
  const starts = availabilityService.enumerateCharterStartsForDay(friday, 'bio');
  const labels = starts.map((dt) => dt.toFormat('yyyy-MM-dd HH:mm'));

  assert.deepStrictEqual(
    labels,
    ['2026-09-25 20:00', '2026-09-25 21:00', '2026-09-25 22:00', '2026-09-25 23:00'],
    'bio enumerate for a calendar evening must be 8–11 PM only (after-midnight appended by listCharterSlotsForDay)'
  );

  // Simulate what listCharterSlotsForDay appends for the operating night.
  const night = [
    slot('2026-09-25T20:00', { used: 0, remaining: 5, max: 5 }),
    slot('2026-09-25T21:00', { used: 0, remaining: 5, max: 5 }),
    slot('2026-09-25T22:00', { used: 0, remaining: 5, max: 5 }),
    slot('2026-09-25T23:00', { used: 0, remaining: 5, max: 5 }),
    slot('2026-09-26T00:00', { used: 0, remaining: 5, max: 5 }),
    slot('2026-09-26T01:00', { used: 0, remaining: 5, max: 5 }),
    slot('2026-09-26T02:00', { used: 0, remaining: 5, max: 5 }),
    slot('2026-09-26T03:00', { used: 0, remaining: 5, max: 5 }),
    slot('2026-09-26T04:00', { used: 0, remaining: 5, max: 5 }),
  ];

  assert.strictEqual(selectFillForwardTarget(night), null, 'open night has no partial fill target');
  const open = applyBioSharedFillForward(night);
  assert.strictEqual(open.length, 9, 'open bio night must keep all 8 PM–4 AM starts');
  assert.deepStrictEqual(
    open.map((s) => s.startHHMM),
    ['20:00', '21:00', '22:00', '23:00', '00:00', '01:00', '02:00', '03:00', '04:00']
  );

  // Wrong-day midnight must not survive window validation as part of Friday evening.
  const bogusMidnight = DateTime.fromISO('2026-09-25T00:00', { zone: ZONE });
  const win = availabilityService.validateCharterSlotWindow({
    charterType: 'bio',
    startIso: bogusMidnight.toUTC().toISO(),
    endIso: bogusMidnight.plus({ hours: 1 }).toUTC().toISO(),
  });
  assert.strictEqual(win.valid, true, '00:00 Thu→Fri night is a valid bio start');
  // But Friday enumerate must not include it:
  assert.ok(!labels.includes('2026-09-25 00:00'));

  const eightPartial = slot('2026-09-25T20:00', { used: 2, remaining: 3, max: 5 });
  const partialNight = [eightPartial, ...night.slice(1)];
  const filled = applyBioSharedFillForward(partialNight);
  assert.strictEqual(filled.length, 1);
  assert.strictEqual(filled[0].startHHMM, '20:00');

  console.log('bioOpenNightAvailability.test.js: all tests passed');
}

run();
