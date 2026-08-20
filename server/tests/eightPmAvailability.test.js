'use strict';

/**
 * Regression tests for 8:00 PM charter availability, overlap semantics, and shared capacity.
 */
const assert = require('assert');
const { DateTime } = require('luxon');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.BUSINESS_TIMEZONE = process.env.BUSINESS_TIMEZONE || 'America/New_York';

const availabilityService = require('../services/availabilityService');
const {
  evaluateSharedCharterCapacity,
  intervalsOverlap,
  bookingRowBlocksSlot,
  isSharedCharterBooking,
} = require('../lib/sharedCharterCapacity');

const ZONE = 'America/New_York';

function localToUtcIso(localIso) {
  return DateTime.fromISO(localIso, { zone: ZONE }).toUTC().toISO();
}

function bookingRow(partial) {
  return {
    id: partial.id,
    status: partial.status || 'confirmed',
    booking_type: 'charter',
    charter_type: partial.charter_type || 'bio',
    charter_seating: partial.charter_seating ?? 'shared',
    boat_id: partial.boat_id || 'boat-1',
    guest_count: partial.guest_count,
    start_time: partial.start_time,
    end_time: partial.end_time,
    expires_at: partial.expires_at ?? null,
    hold_expires_at: partial.hold_expires_at ?? null,
  };
}

function assertOverlap(label, aStart, aEnd, bStart, bEnd, expected) {
  const result = intervalsOverlap(
    new Date(aStart).getTime(),
    new Date(aEnd).getTime(),
    new Date(bStart).getTime(),
    new Date(bEnd).getTime()
  );
  assert.strictEqual(result, expected, `${label}: expected overlap=${expected}, got ${result}`);
}

function run() {
  const eightStart = localToUtcIso('2026-07-02T20:00');
  const eightEnd = localToUtcIso('2026-07-02T21:00');
  const sevenStart = localToUtcIso('2026-07-02T19:00');
  const sevenEnd = localToUtcIso('2026-07-02T20:00');
  const sevenThirtyStart = localToUtcIso('2026-07-02T19:30');
  const sevenThirtyEnd = localToUtcIso('2026-07-02T20:30');
  const nineEnd = localToUtcIso('2026-07-02T22:00');

  assertOverlap('7–8 PM vs 8–9 PM touching', sevenStart, sevenEnd, eightStart, eightEnd, false);
  assertOverlap('7:30–8:30 PM vs 8–9 PM', sevenThirtyStart, sevenThirtyEnd, eightStart, eightEnd, true);
  assertOverlap('8–9 PM vs 8–9 PM exact', eightStart, eightEnd, eightStart, eightEnd, true);
  assertOverlap('8–9 PM vs 9–10 PM touching', eightStart, eightEnd, eightEnd, nineEnd, false);

  const bioWindow = availabilityService.validateCharterSlotWindow({
    charterType: 'bio',
    startIso: eightStart,
    endIso: eightEnd,
  });
  assert.strictEqual(bioWindow.valid, true, '8 PM bio window should be valid on Friday');

  assert.strictEqual(
    availabilityService.isSharedCharterBookingRequest({ charterType: 'bio' }),
    true,
    'bio defaults to shared'
  );
  assert.strictEqual(
    availabilityService.isSharedCharterBookingRequest({
      charterType: 'bio',
      charterVariant: 'private',
    }),
    false,
    'private bio variant is exclusive'
  );
  assert.strictEqual(
    availabilityService.resolveCharterSeatingForInsert({ charterType: 'bio' }),
    'shared'
  );
  assert.strictEqual(
    availabilityService.resolveCharterSeatingForInsert({
      charterType: 'bio',
      charterVariant: 'private',
    }),
    'private'
  );

  let cap = evaluateSharedCharterCapacity({
    overlappingBookings: [
      bookingRow({ id: 'a', guest_count: 2, start_time: eightStart, end_time: eightEnd }),
      bookingRow({ id: 'b', guest_count: 2, start_time: eightStart, end_time: eightEnd }),
    ],
    proposedGuestCount: 1,
  });
  assert.strictEqual(cap.available, true, '2 + 2 + 1 = 5 allowed');
  assert.strictEqual(cap.capacity.remaining, 0);

  cap = evaluateSharedCharterCapacity({
    overlappingBookings: [
      bookingRow({ id: 'a', guest_count: 2, start_time: eightStart, end_time: eightEnd }),
      bookingRow({ id: 'b', guest_count: 2, start_time: eightStart, end_time: eightEnd }),
    ],
    proposedGuestCount: 2,
  });
  assert.strictEqual(cap.available, false, '2 + 2 + 2 = 6 rejected');
  assert.strictEqual(cap.reason, 'charter_capacity');

  cap = evaluateSharedCharterCapacity({
    overlappingBookings: [
      bookingRow({ id: 'a', guest_count: 3, start_time: eightStart, end_time: eightEnd }),
    ],
    proposedGuestCount: 3,
  });
  assert.strictEqual(cap.available, false, '3 + 3 = 6 rejected');

  cap = evaluateSharedCharterCapacity({
    overlappingBookings: [
      bookingRow({ id: 'a', guest_count: 5, start_time: eightStart, end_time: eightEnd }),
    ],
    proposedGuestCount: 1,
  });
  assert.strictEqual(cap.available, false, '5 + 1 = 6 rejected');

  cap = evaluateSharedCharterCapacity({
    overlappingBookings: [
      bookingRow({
        id: 'cancelled',
        guest_count: 5,
        status: 'cancelled',
        start_time: eightStart,
        end_time: eightEnd,
      }),
    ],
    proposedGuestCount: 2,
  });
  assert.strictEqual(cap.available, true, 'cancelled 8 PM booking does not block');

  const expiredPending = bookingRow({
    id: 'expired',
    guest_count: 5,
    status: 'pending',
    expires_at: new Date(Date.now() - 60_000).toISOString(),
    start_time: eightStart,
    end_time: eightEnd,
  });
  assert.strictEqual(bookingRowBlocksSlot(expiredPending), false, 'expired pending hold ignored');

  const expiredStaffHold = bookingRow({
    id: 'expired-staff-hold',
    guest_count: 2,
    status: 'hold',
    hold_expires_at: new Date(Date.now() - 60_000).toISOString(),
    start_time: eightStart,
    end_time: eightEnd,
  });
  assert.strictEqual(bookingRowBlocksSlot(expiredStaffHold), false, 'expired staff hold ignored');

  cap = evaluateSharedCharterCapacity({
    overlappingBookings: [expiredPending],
    proposedGuestCount: 5,
  });
  assert.strictEqual(cap.available, true, 'expired pending does not consume capacity');

  cap = evaluateSharedCharterCapacity({
    overlappingBookings: [
      bookingRow({ id: 'hold', guest_count: 2, status: 'hold', start_time: eightStart, end_time: eightEnd }),
    ],
    proposedGuestCount: 3,
  });
  assert.strictEqual(cap.available, true, 'active hold counts toward capacity');

  cap = evaluateSharedCharterCapacity({
    overlappingBookings: [
      bookingRow({ id: 'hold', guest_count: 2, status: 'hold', start_time: eightStart, end_time: eightEnd }),
      bookingRow({ id: 'b', guest_count: 2, start_time: eightStart, end_time: eightEnd }),
    ],
    proposedGuestCount: 2,
  });
  assert.strictEqual(cap.available, false, 'hold + bookings reaching capacity blocks extra guests');

  cap = evaluateSharedCharterCapacity({
    overlappingBookings: [
      bookingRow({ id: 'edit', guest_count: 2, start_time: eightStart, end_time: eightEnd }),
      bookingRow({ id: 'other', guest_count: 3, start_time: eightStart, end_time: eightEnd }),
    ],
    proposedGuestCount: 3,
    excludeBookingId: 'edit',
  });
  assert.strictEqual(cap.available, false, 'edit excludes self but still sees other bookings');

  assert.strictEqual(
    isSharedCharterBooking(
      bookingRow({ charter_type: 'bio', charter_seating: null, boat_id: 'boat-1' })
    ),
    true,
    'bio without explicit seating is shared'
  );

  const overnightStart = localToUtcIso('2026-07-02T23:00');
  const overnightEnd = localToUtcIso('2026-07-03T00:00');
  const midnightStart = localToUtcIso('2026-07-03T00:00');
  const midnightEnd = localToUtcIso('2026-07-03T01:00');
  const lateOverlapStart = localToUtcIso('2026-07-02T23:30');
  const lateOverlapEnd = localToUtcIso('2026-07-03T00:30');

  assertOverlap('11 PM–midnight vs midnight–1 AM touching', overnightStart, overnightEnd, midnightStart, midnightEnd, false);
  assertOverlap('11:30 PM–12:30 AM vs midnight–1 AM', lateOverlapStart, lateOverlapEnd, midnightStart, midnightEnd, true);

  const overnightBio = availabilityService.validateCharterSlotWindow({
    charterType: 'bio',
    startIso: overnightStart,
    endIso: overnightEnd,
  });
  assert.strictEqual(overnightBio.valid, true, '11 PM–midnight bio departure is valid');

  const fullMsg = availabilityService.charterUnavailableUserMessage(
    { reason: 'charter_capacity', message: null },
    eightStart
  );
  assert.ok(fullMsg.includes('8:00 PM'), fullMsg);
  assert.ok(fullMsg.toLowerCase().includes('full'), fullMsg);

  console.log('eightPmAvailability.test: all assertions passed');
}

run();
