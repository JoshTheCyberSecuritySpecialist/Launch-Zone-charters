'use strict';

/**
 * Phase B: atomic fleet pick helpers + contention classification (no live DB).
 */
const assert = require('assert');
const {
  isCharterHoldContentionError,
  isMissingRpcError,
  normalizeRpcCapacity,
  unwrapRpcPayload,
  BIO_DEPARTURE_JUST_FILLED_MESSAGE,
} = require('../services/charterFleetAtomic');
const { selectFleetBoatForParty } = require('../services/charterFleetAllocation');

function run() {
  assert.ok(BIO_DEPARTURE_JUST_FILLED_MESSAGE.includes('just filled'));

  assert.deepStrictEqual(unwrapRpcPayload(null), null);
  assert.deepStrictEqual(unwrapRpcPayload({ ok: true, boat_id: 'b1' }), {
    ok: true,
    boat_id: 'b1',
  });
  assert.deepStrictEqual(unwrapRpcPayload('{"ok":true,"boat_id":"b2"}'), {
    ok: true,
    boat_id: 'b2',
  });
  assert.strictEqual(unwrapRpcPayload('not-json'), null);

  assert.strictEqual(isMissingRpcError({ code: 'PGRST202' }), true);
  assert.strictEqual(isMissingRpcError({ code: '42883' }), true);
  assert.strictEqual(
    isMissingRpcError({ message: 'Could not find the function public.lz_pick_charter_fleet_boat' }),
    true
  );
  assert.strictEqual(isMissingRpcError({ message: 'permission denied' }), false);

  const emptyFourGuestRpc = normalizeRpcCapacity({ used: 0, remaining: 1, fleet_used: 0 }, 4);
  assert.strictEqual(emptyFourGuestRpc.remaining, 5);
  assert.strictEqual(emptyFourGuestRpc.remainingAfter, 1);
  assert.strictEqual(emptyFourGuestRpc.requested, 4);

  const partialSoloRpc = normalizeRpcCapacity({ used: 4, remaining: 0, fleet_used: 4 }, 1);
  assert.strictEqual(partialSoloRpc.remaining, 1);
  assert.strictEqual(partialSoloRpc.remainingAfter, 0);

  assert.strictEqual(isCharterHoldContentionError({ code: '23P01' }), true);
  assert.strictEqual(
    isCharterHoldContentionError({ message: 'shared_charter_capacity_exceeded:1' }),
    true
  );
  assert.strictEqual(
    isCharterHoldContentionError({ message: 'shared_charter_exclusive_conflict' }),
    true
  );
  assert.strictEqual(
    isCharterHoldContentionError({ message: 'bookings_boat_no_time_overlap' }),
    true
  );
  assert.strictEqual(isCharterHoldContentionError({ message: 'network timeout' }), false);

  // Losing concurrent pontoon claim → retry should pick center console.
  const afterPontoonFilled = selectFleetBoatForParty(
    [
      {
        boatId: 'pontoon',
        priority: 1,
        available: false,
        used: 5,
        remaining: 0,
      },
      {
        boatId: 'console',
        priority: 2,
        available: true,
        used: 0,
        remaining: 5,
      },
    ],
    { passengerCount: 2 }
  );
  assert.strictEqual(afterPontoonFilled.boatId, 'console');

  // Sticky preferred still preferred when it fits.
  const stickyFit = selectFleetBoatForParty(
    [
      { boatId: 'console', priority: 2, available: true, used: 0, remaining: 5 },
      { boatId: 'pontoon', priority: 1, available: true, used: 2, remaining: 3 },
    ],
    { passengerCount: 1 }
  );
  assert.strictEqual(stickyFit.boatId, 'pontoon');

  console.log('charterFleetAtomic.test.js: all tests passed');
}

run();
