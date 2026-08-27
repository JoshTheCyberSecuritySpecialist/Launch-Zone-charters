const assert = require('assert');
const { DateTime } = require('luxon');
const {
  evaluateSharedCharterCapacity,
  intervalsOverlap,
  isSharedCharterBooking,
} = require('../lib/sharedCharterCapacity');

function bookingRow(partial) {
  return {
    id: partial.id,
    status: partial.status || 'confirmed',
    booking_type: partial.booking_type || 'charter',
    charter_type: partial.charter_type || 'captain_charter',
    charter_seating: partial.charter_seating ?? 'shared',
    pricing_package_id: partial.pricing_package_id || null,
    boat_id: partial.boat_id || 'boat-1',
    guest_count: partial.guest_count,
    start_time: partial.start_time,
    end_time: partial.end_time,
    expires_at: partial.expires_at || null,
  };
}

function run() {
  const zone = 'America/New_York';
  const friStart = DateTime.fromISO('2026-01-02T18:00', { zone }).toUTC().toISO();
  const friEnd = DateTime.fromISO('2026-01-02T19:00', { zone }).toUTC().toISO();
  const overnightEnd = DateTime.fromISO('2026-01-03T01:00', { zone }).toUTC().toISO();

  assert.strictEqual(isSharedCharterBooking(bookingRow({ charter_seating: 'shared' })), true);
  assert.strictEqual(isSharedCharterBooking(bookingRow({ charter_seating: 'private' })), false);
  assert.strictEqual(isSharedCharterBooking(bookingRow({ booking_type: 'rental' })), false);
  assert.strictEqual(
    isSharedCharterBooking(
      bookingRow({ charter_type: 'bio', charter_seating: null, boat_id: 'boat-1' })
    ),
    true
  );
  assert.strictEqual(
    isSharedCharterBooking(
      bookingRow({ charter_type: 'bio', charter_seating: 'private', boat_id: 'boat-1' })
    ),
    true
  );

  assert.strictEqual(
    isSharedCharterBooking(
      bookingRow({
        charter_type: 'captain_charter',
        charter_seating: 'private',
        pricing_package_id: 'bio_two',
        boat_id: 'boat-1',
      })
    ),
    true
  );

  let result = evaluateSharedCharterCapacity({
    overlappingBookings: [
      bookingRow({
        id: 'private-tagged-bio',
        charter_type: 'bio',
        charter_seating: 'private',
        guest_count: 2,
        start_time: friStart,
        end_time: friEnd,
      }),
    ],
    proposedGuestCount: 2,
  });
  assert.strictEqual(result.available, true);
  assert.strictEqual(result.reason, null);

  const fiveSingles = Array.from({ length: 5 }, (_, i) =>
    bookingRow({ id: String(i + 1), guest_count: 1, start_time: friStart, end_time: friEnd })
  );
  const fourSingles = fiveSingles.slice(0, 4);
  result = evaluateSharedCharterCapacity({
    overlappingBookings: fourSingles,
    proposedGuestCount: 1,
  });
  assert.strictEqual(result.available, true);
  assert.strictEqual(result.capacity.remaining, 0);

  result = evaluateSharedCharterCapacity({
    overlappingBookings: fiveSingles,
    proposedGuestCount: 1,
  });
  assert.strictEqual(result.available, false);
  assert.strictEqual(result.reason, 'charter_capacity');

  result = evaluateSharedCharterCapacity({
    overlappingBookings: [
      bookingRow({ id: 'a', guest_count: 2, start_time: friStart, end_time: friEnd }),
      bookingRow({ id: 'b', guest_count: 3, start_time: friStart, end_time: friEnd }),
    ],
    proposedGuestCount: 1,
  });
  assert.strictEqual(result.available, false);

  result = evaluateSharedCharterCapacity({
    overlappingBookings: [bookingRow({ id: 'a', guest_count: 2, start_time: friStart, end_time: friEnd })],
    proposedGuestCount: 3,
  });
  assert.strictEqual(result.available, true);
  assert.strictEqual(result.capacity.remaining, 0);

  result = evaluateSharedCharterCapacity({
    overlappingBookings: [bookingRow({ id: 'a', guest_count: 3, start_time: friStart, end_time: friEnd })],
    proposedGuestCount: 3,
  });
  assert.strictEqual(result.available, false);

  result = evaluateSharedCharterCapacity({
    overlappingBookings: [],
    proposedGuestCount: 2,
  });
  assert.strictEqual(result.available, true);
  assert.strictEqual(result.capacity.remaining, 3);

  const overnightStart = DateTime.fromISO('2026-01-02T23:00', { zone }).toUTC().toISO();
  const overnightPartial = DateTime.fromISO('2026-01-03T00:30', { zone }).toUTC().toISO();
  assert.strictEqual(
    intervalsOverlap(
      new Date(overnightStart).getTime(),
      new Date(overnightEnd).getTime(),
      new Date(overnightPartial).getTime(),
      new Date(overnightEnd).getTime()
    ),
    true
  );
  result = evaluateSharedCharterCapacity({
    overlappingBookings: [
      bookingRow({
        id: 'n1',
        guest_count: 3,
        start_time: overnightStart,
        end_time: overnightEnd,
      }),
    ],
    proposedGuestCount: 2,
  });
  assert.strictEqual(result.available, true);
  result = evaluateSharedCharterCapacity({
    overlappingBookings: [
      bookingRow({
        id: 'n1',
        guest_count: 3,
        start_time: overnightStart,
        end_time: overnightEnd,
      }),
    ],
    proposedGuestCount: 3,
  });
  assert.strictEqual(result.available, false);

  result = evaluateSharedCharterCapacity({
    overlappingBookings: [bookingRow({ id: 'c', guest_count: 1, status: 'cancelled', start_time: friStart, end_time: friEnd })],
    proposedGuestCount: 5,
  });
  assert.strictEqual(result.available, true);

  result = evaluateSharedCharterCapacity({
    overlappingBookings: [bookingRow({ id: 'edit', guest_count: 2, start_time: friStart, end_time: friEnd })],
    proposedGuestCount: 3,
    excludeBookingId: 'edit',
  });
  assert.strictEqual(result.available, true);

  result = evaluateSharedCharterCapacity({
    overlappingBookings: [
      bookingRow({ id: 'edit', guest_count: 2, start_time: friStart, end_time: friEnd }),
      bookingRow({ id: 'other', guest_count: 2, start_time: friStart, end_time: friEnd }),
    ],
    proposedGuestCount: 4,
    excludeBookingId: 'edit',
  });
  assert.strictEqual(result.available, false);

  result = evaluateSharedCharterCapacity({
    overlappingBookings: [bookingRow({ id: 'r1', booking_type: 'rental', guest_count: 1, start_time: friStart, end_time: friEnd })],
    proposedGuestCount: 1,
  });
  assert.strictEqual(result.available, false);
  assert.strictEqual(result.reason, 'exclusive_conflict');

  console.log('sharedCharterCapacity.test: all assertions passed');
}

run();
