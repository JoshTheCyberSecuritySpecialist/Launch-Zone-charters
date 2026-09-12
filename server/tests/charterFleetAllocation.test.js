'use strict';

/**
 * Phase A: fleet priority + party-size-aware boat selection (no DB).
 */
const assert = require('assert');
const {
  getMaxSimultaneousCharterBoats,
  getActiveCharterFleetPriority,
  isTwoBoatCoverageEnabled,
  CHARTER_FLEET_PRIORITY,
} = require('../config/charterFleetPriority');
const {
  selectFleetBoatForParty,
  sumFleetUsed,
  buildAssignedCapacity,
} = require('../services/charterFleetAllocation');
const {
  applyBioSharedFillForward,
  selectFillForwardTarget,
} = require('../services/bioSharedFillForward');
const { DateTime } = require('luxon');

const ZONE = 'America/New_York';

function localToUtcIso(localIso) {
  return DateTime.fromISO(localIso, { zone: ZONE }).toUTC().toISO();
}

function slot(localStart, capacity) {
  const start = localToUtcIso(localStart);
  const end = DateTime.fromISO(localStart, { zone: ZONE }).plus({ hours: 1 }).toUTC().toISO();
  return {
    start,
    end,
    startHHMM: DateTime.fromISO(localStart, { zone: ZONE }).toFormat('HH:mm'),
    label: DateTime.fromISO(localStart, { zone: ZONE }).toFormat('h:mm a'),
    available: true,
    capacity,
  };
}

function run() {
  // Coverage defaults to one boat
  assert.strictEqual(getMaxSimultaneousCharterBoats({}), 1);
  assert.strictEqual(isTwoBoatCoverageEnabled({}), false);
  assert.strictEqual(getActiveCharterFleetPriority({}).length, 1);
  assert.strictEqual(getActiveCharterFleetPriority({})[0].registration, 'FL0278PU');

  assert.strictEqual(getMaxSimultaneousCharterBoats({ CHARTER_MAX_SIMULTANEOUS_BOATS: '2' }), 2);
  assert.strictEqual(isTwoBoatCoverageEnabled({ CHARTER_TWO_BOAT_COVERAGE: 'true' }), true);
  assert.strictEqual(getActiveCharterFleetPriority({ CHARTER_MAX_SIMULTANEOUS_BOATS: '2' }).length, 2);
  assert.strictEqual(CHARTER_FLEET_PRIORITY[1].registration, 'FL3827TT');

  const pontoon = {
    boatId: 'pontoon-id',
    priority: 1,
    role: 'pontoon',
    available: true,
    used: 0,
    remaining: 5,
    capacity: { max: 5, used: 0, remaining: 5, requested: 2 },
  };
  const consoleBoat = {
    boatId: 'console-id',
    priority: 2,
    role: 'center_console',
    available: true,
    used: 0,
    remaining: 5,
    capacity: { max: 5, used: 0, remaining: 5, requested: 2 },
  };

  // 1: first shared booking uses pontoon
  let selected = selectFleetBoatForParty([pontoon, consoleBoat], { passengerCount: 2 });
  assert.strictEqual(selected.boatId, 'pontoon-id');

  // 2–3: continue filling pontoon when party fits
  selected = selectFleetBoatForParty(
    [
      { ...pontoon, used: 3, remaining: 2, available: true },
      { ...consoleBoat, used: 0, remaining: 5, available: true },
    ],
    { passengerCount: 2 }
  );
  assert.strictEqual(selected.boatId, 'pontoon-id');

  // 4–5: party too large for remaining pontoon seats moves intact to center console
  selected = selectFleetBoatForParty(
    [
      { ...pontoon, used: 4, remaining: 1, available: false },
      { ...consoleBoat, used: 0, remaining: 5, available: true },
    ],
    { passengerCount: 2 }
  );
  assert.strictEqual(selected.boatId, 'console-id');

  // 6: later solo can fill final pontoon seat while console also has guests
  selected = selectFleetBoatForParty(
    [
      { ...pontoon, used: 4, remaining: 1, available: true },
      { ...consoleBoat, used: 2, remaining: 3, available: true },
    ],
    { passengerCount: 1 }
  );
  assert.strictEqual(selected.boatId, 'pontoon-id');

  // Prefer partial console over empty pontoon when pontoon unavailable
  selected = selectFleetBoatForParty(
    [
      { ...pontoon, available: false, used: 5, remaining: 0 },
      { ...consoleBoat, used: 2, remaining: 3, available: true },
    ],
    { passengerCount: 1 }
  );
  assert.strictEqual(selected.boatId, 'console-id');

  // 10: blocked pontoon → center console
  selected = selectFleetBoatForParty(
    [
      { ...pontoon, available: false, used: 0, remaining: 0 },
      { ...consoleBoat, available: true, used: 0, remaining: 5 },
    ],
    { passengerCount: 3 }
  );
  assert.strictEqual(selected.boatId, 'console-id');

  // 14: one-boat coverage → only pontoon in active fleet (caller supplies one state)
  selected = selectFleetBoatForParty([{ ...pontoon, used: 5, available: false }], { passengerCount: 1 });
  assert.strictEqual(selected, null);

  // Private prefers empty highest-priority boat
  selected = selectFleetBoatForParty(
    [
      { ...pontoon, used: 2, available: true },
      { ...consoleBoat, used: 0, available: true },
    ],
    { passengerCount: 4, mode: 'private' }
  );
  assert.strictEqual(selected.boatId, 'console-id');

  selected = selectFleetBoatForParty(
    [
      { ...pontoon, used: 0, available: true },
      { ...consoleBoat, used: 0, available: true },
    ],
    { passengerCount: 4, mode: 'private' }
  );
  assert.strictEqual(selected.boatId, 'pontoon-id');

  assert.strictEqual(
    sumFleetUsed([
      { used: 5 },
      { used: 2 },
    ]),
    7
  );

  const capacity = buildAssignedCapacity(
    { ...consoleBoat, used: 0, capacity: { max: 5, used: 0, remaining: 3, requested: 2 } },
    [
      { used: 5 },
      { used: 0 },
    ]
  );
  assert.strictEqual(capacity.fleetUsed, 5);
  assert.strictEqual(capacity.remaining, 3);

  // Fill-forward: pontoon full + console open keeps same hour via fleetUsed
  const eight = slot('2026-07-10T20:00', {
    used: 0,
    remaining: 5,
    max: 5,
    fleetUsed: 5,
  });
  const nine = slot('2026-07-10T21:00', { used: 0, remaining: 5, max: 5, fleetUsed: 0 });
  let target = selectFillForwardTarget([eight, nine]);
  assert.strictEqual(target.start, eight.start);
  let filtered = applyBioSharedFillForward([eight, nine]);
  assert.strictEqual(filtered.length, 1);
  assert.strictEqual(filtered[0].start, eight.start);

  // Both boats full for this party → only later hour eligible → opens next hour
  const nineOnly = slot('2026-07-10T21:00', { used: 0, remaining: 5, max: 5, fleetUsed: 0 });
  filtered = applyBioSharedFillForward([nineOnly]);
  assert.strictEqual(filtered[0].start, nineOnly.start);

  console.log('charterFleetAllocation.test.js: all tests passed');
}

run();
