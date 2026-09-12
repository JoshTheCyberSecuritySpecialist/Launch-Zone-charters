'use strict';

/**
 * Phase C: dual-boat captain coverage + ready_for_departure gates.
 */
const assert = require('assert');
const {
  evaluateReadyForDeparture,
  findDualBoatCaptainIssues,
  findSimultaneousMultiBoatClusters,
  READY_CAPTAIN_REQUIRED_MESSAGE,
  READY_DUAL_CAPTAIN_MESSAGE,
  DUAL_BOAT_CAPTAIN_GAP_LABEL,
  CENTER_CONSOLE_MISSING_CAPTAIN_LABEL,
} = require('../services/charterDualCaptainRules');
const { buildScheduleConflicts } = require('../services/adminOperationsDashboardService');

function charter(partial) {
  return {
    id: partial.id,
    booking_type: 'charter',
    charter_type: partial.charter_type || 'bio',
    charter_seating: partial.charter_seating || 'shared',
    status: partial.status || 'confirmed',
    boat_id: partial.boat_id,
    captain_id: partial.captain_id ?? null,
    start_time: partial.start_time,
    end_time: partial.end_time,
    guest_count: partial.guest_count || 2,
    expires_at: null,
    hold_expires_at: null,
    boats: partial.boats || null,
  };
}

function run() {
  const start = '2026-09-12T00:00:00.000Z'; // 8pm ET Fri
  const end = '2026-09-12T01:00:00.000Z';

  const pontoon = charter({
    id: 'b-pontoon',
    boat_id: 'boat-pontoon',
    captain_id: 'cap-1',
    start_time: start,
    end_time: end,
    boats: { name: 'SunCatcher', type: 'standard' },
  });
  const consoleBoat = charter({
    id: 'b-console',
    boat_id: 'boat-console',
    captain_id: null,
    start_time: start,
    end_time: end,
    boats: { name: 'Key Largo', type: 'premium' },
  });

  const clusters = findSimultaneousMultiBoatClusters([pontoon, consoleBoat]);
  assert.strictEqual(clusters.length, 1);
  assert.strictEqual(clusters[0].length, 2);

  const issues = findDualBoatCaptainIssues([pontoon, consoleBoat]);
  assert.ok(issues.some((c) => c.type === 'dual_boat_captain_gap'));
  assert.ok(issues.some((c) => c.type === 'center_console_missing_captain'));
  assert.ok(issues.some((c) => c.label === DUAL_BOAT_CAPTAIN_GAP_LABEL));
  assert.ok(issues.some((c) => c.label === CENTER_CONSOLE_MISSING_CAPTAIN_LABEL));

  let ready = evaluateReadyForDeparture(consoleBoat, [pontoon]);
  assert.strictEqual(ready.ok, false);
  assert.strictEqual(ready.message, READY_CAPTAIN_REQUIRED_MESSAGE);

  ready = evaluateReadyForDeparture({ ...consoleBoat, captain_id: 'cap-1' }, [pontoon]);
  assert.strictEqual(ready.ok, false);
  assert.strictEqual(ready.message, READY_DUAL_CAPTAIN_MESSAGE);

  ready = evaluateReadyForDeparture({ ...consoleBoat, captain_id: 'cap-2' }, [pontoon]);
  assert.strictEqual(ready.ok, true);

  // Single boat with captain is fine
  ready = evaluateReadyForDeparture(pontoon, []);
  assert.strictEqual(ready.ok, true);

  // Single boat without captain blocked
  ready = evaluateReadyForDeparture({ ...pontoon, captain_id: null }, []);
  assert.strictEqual(ready.ok, false);

  // Rentals skip captain gate
  ready = evaluateReadyForDeparture({ ...pontoon, booking_type: 'rental', captain_id: null }, []);
  assert.strictEqual(ready.ok, true);

  // Ops conflict list includes dual-boat gap
  const conflicts = buildScheduleConflicts(
    [pontoon, consoleBoat],
    [pontoon, consoleBoat],
    'America/New_York'
  );
  assert.ok(conflicts.some((c) => c.type === 'dual_boat_captain_gap'));
  assert.ok(conflicts.some((c) => c.type === 'center_console_missing_captain'));

  console.log('charterDualCaptainRules.test.js: all tests passed');
}

run();
