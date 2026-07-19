const assert = require('assert');
const { DateTime } = require('luxon');

const {
  generateCharterCaptainBlocks,
  charterClosedLocalIntervalsForDay,
  findCharterConflictsForBlocks,
  BUSINESS_TZ,
} = require('../services/captainCharterAvailability');

function run() {
  const friday = DateTime.fromISO('2026-01-02', { zone: BUSINESS_TZ });
  const saturday = DateTime.fromISO('2026-01-03', { zone: BUSINESS_TZ });
  const monday = DateTime.fromISO('2026-01-05', { zone: BUSINESS_TZ });
  const sunday = DateTime.fromISO('2026-01-04', { zone: BUSINESS_TZ });

  const friClosed = charterClosedLocalIntervalsForDay(friday);
  assert.strictEqual(friClosed.length, 2);
  assert.ok(friClosed.some((i) => i.start.hour === 0 && i.end.hour === 17));
  assert.ok(friClosed.some((i) => i.start.hour === 4 && i.start.minute === 1 && i.end.hour === 17));

  const satClosed = charterClosedLocalIntervalsForDay(saturday);
  assert.strictEqual(satClosed.length, 2);
  assert.ok(satClosed.some((i) => i.start.hour === 0 && i.end.hour === 17));
  assert.ok(satClosed.some((i) => i.start.hour === 4 && i.start.minute === 1 && i.end.hour === 17));

  const monClosed = charterClosedLocalIntervalsForDay(monday);
  assert.strictEqual(monClosed.length, 1);
  assert.strictEqual(monClosed[0].start.hour, 0);
  assert.strictEqual(monClosed[0].end.hour, 17);

  const sunClosed = charterClosedLocalIntervalsForDay(sunday);
  assert.strictEqual(sunClosed.length, 1);
  assert.strictEqual(sunClosed[0].start.hour, 4);
  assert.strictEqual(sunClosed[0].start.minute, 1);

  const blocks = generateCharterCaptainBlocks('2026-01-01', '2026-01-07');
  assert.ok(blocks.length >= 3);
  assert.strictEqual(blocks[0].block_scope, 'charter');
  assert.strictEqual(blocks[0].block_source, 'charter_captain_availability');

  const conflicts = findCharterConflictsForBlocks(blocks, [
    {
      id: '1',
      status: 'confirmed',
      start_time: DateTime.fromISO('2026-01-02T20:00', { zone: BUSINESS_TZ }).toUTC().toISO(),
      end_time: DateTime.fromISO('2026-01-02T21:00', { zone: BUSINESS_TZ }).toUTC().toISO(),
      customers: { full_name: 'Guest' },
    },
    {
      id: '2',
      status: 'confirmed',
      start_time: DateTime.fromISO('2026-01-05T12:00', { zone: BUSINESS_TZ }).toUTC().toISO(),
      end_time: DateTime.fromISO('2026-01-05T13:00', { zone: BUSINESS_TZ }).toUTC().toISO(),
      customers: { full_name: 'Guest' },
    },
  ]);
  assert.strictEqual(conflicts.length, 1);
  assert.strictEqual(conflicts[0].id, '2');

  console.log('captainCharterAvailability.test: all assertions passed');
}

run();
