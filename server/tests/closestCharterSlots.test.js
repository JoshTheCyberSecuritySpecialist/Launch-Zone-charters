'use strict';

const assert = require('assert');
const { rankClosestCharterSlots } = require('../lib/closestCharterSlots');

function run() {
  const requested = '2026-08-29T01:00:00.000Z'; // 9:00 PM ET
  const slots = [
    { start: '2026-08-29T00:00:00.000Z', label: '8:00 PM', startHHMM: '20:00', available: true },
    { start: '2026-08-29T01:00:00.000Z', label: '9:00 PM', startHHMM: '21:00', available: true },
    { start: '2026-08-29T02:00:00.000Z', label: '10:00 PM', startHHMM: '22:00', available: true },
    { start: '2026-08-29T03:00:00.000Z', label: '11:00 PM', startHHMM: '23:00', available: true },
    { start: '2026-08-29T04:00:00.000Z', label: '12:00 AM', startHHMM: '00:00', available: true },
  ];

  const closest = rankClosestCharterSlots(slots, requested, 3);
  assert.strictEqual(closest.length, 3);
  assert.ok(!closest.some((slot) => slot.start === requested), 'requested slot is excluded');
  assert.strictEqual(closest[0].label, '8:00 PM');
  assert.deepStrictEqual(
    closest.map((slot) => slot.label),
    ['8:00 PM', '10:00 PM', '11:00 PM']
  );

  const none = rankClosestCharterSlots([], requested, 3);
  assert.deepStrictEqual(none, []);
  console.log('closestCharterSlots.test.js: ok');
}

run();
