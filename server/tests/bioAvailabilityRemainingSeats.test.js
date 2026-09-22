'use strict';

process.env.BUSINESS_TIMEZONE = process.env.BUSINESS_TIMEZONE || 'America/New_York';

const assert = require('assert');
const { DateTime } = require('luxon');
const {
  bookingRowBlocksSlot,
  evaluateSharedCharterCapacity,
  intervalsOverlap,
} = require('../lib/sharedCharterCapacity');

const ZONE = 'America/New_York';
const BOAT_ID = 'captain-boat';
const OTHER_BOAT_ID = 'other-boat';

function localToUtcIso(localIso) {
  return DateTime.fromISO(localIso, { zone: ZONE }).toUTC().toISO();
}

function slotForOperatingNight(operatingDate, hhmm) {
  const [hour, minute] = String(hhmm).split(':').map(Number);
  const dayOffset = hour < 12 ? 1 : 0;
  const start = DateTime.fromISO(operatingDate, { zone: ZONE })
    .plus({ days: dayOffset })
    .set({ hour, minute, second: 0, millisecond: 0 });
  return {
    operatingDate,
    hhmm,
    startIso: start.toUTC().toISO(),
    endIso: start.plus({ hours: 1 }).toUTC().toISO(),
    localStart: start.toFormat('yyyy-MM-dd HH:mm'),
  };
}

function bookingRow(partial) {
  return {
    id: partial.id,
    status: partial.status || 'confirmed',
    booking_type: partial.booking_type || 'charter',
    charter_type: partial.charter_type || 'bio',
    charter_seating: partial.charter_seating ?? 'shared',
    pricing_package_id: partial.pricing_package_id || 'bio_solo',
    boat_id: partial.boat_id || BOAT_ID,
    guest_count: partial.guest_count,
    start_time: partial.start_time,
    end_time: partial.end_time,
    expires_at: partial.expires_at ?? null,
    hold_expires_at: partial.hold_expires_at ?? null,
  };
}

function scopedRows(rows, slot) {
  const startMs = new Date(slot.startIso).getTime();
  const endMs = new Date(slot.endIso).getTime();
  return rows.filter((row) => {
    if (String(row.boat_id) !== BOAT_ID) return false;
    return intervalsOverlap(
      startMs,
      endMs,
      new Date(String(row.start_time)).getTime(),
      new Date(String(row.end_time)).getTime()
    );
  });
}

function capacityForSlot(rows, slot, proposedGuestCount) {
  return evaluateSharedCharterCapacity({
    overlappingBookings: scopedRows(rows, slot),
    proposedGuestCount,
  });
}

function run() {
  const departureTimes = ['20:00', '21:00', '22:00', '23:00', '00:00', '01:00', '02:00', '03:00'];
  const operatingDates = [
    '2026-10-11', // reported customer-facing failure
    '2026-10-31', // month-end overnight
    '2026-12-31', // year-end overnight
    '2026-11-01', // DST fall-back date in America/New_York
    '2027-03-14', // DST spring-forward date in America/New_York
  ];

  for (const operatingDate of operatingDates) {
    for (const hhmm of departureTimes) {
      const slot = slotForOperatingNight(operatingDate, hhmm);
      const empty = capacityForSlot([], slot, 4);
      assert.strictEqual(
        empty.available,
        true,
        `${operatingDate} ${hhmm} should accept a four-guest party when empty`
      );
      assert.strictEqual(
        empty.capacity.remaining,
        5,
        `${operatingDate} ${hhmm} (${slot.localStart}) must show full remaining seats before checkout hold`
      );
      assert.strictEqual(empty.capacity.remainingAfter, 1);
    }
  }

  const eightPm = slotForOperatingNight('2026-10-11', '20:00');
  let result = capacityForSlot(
    [bookingRow({ id: 'two-booked', guest_count: 2, start_time: eightPm.startIso, end_time: eightPm.endIso })],
    eightPm,
    1
  );
  assert.strictEqual(result.available, true);
  assert.strictEqual(result.capacity.remaining, 3);

  result = capacityForSlot(
    [bookingRow({ id: 'four-booked', guest_count: 4, start_time: eightPm.startIso, end_time: eightPm.endIso })],
    eightPm,
    1
  );
  assert.strictEqual(result.available, true);
  assert.strictEqual(result.capacity.remaining, 1);
  assert.strictEqual(result.capacity.remainingAfter, 0);

  result = capacityForSlot(
    [bookingRow({ id: 'five-booked', guest_count: 5, start_time: eightPm.startIso, end_time: eightPm.endIso })],
    eightPm,
    1
  );
  assert.strictEqual(result.available, false);
  assert.strictEqual(result.capacity.remaining, 0);

  const ignoredRows = [
    bookingRow({ id: 'cancelled', status: 'cancelled', guest_count: 5, start_time: eightPm.startIso, end_time: eightPm.endIso }),
    bookingRow({ id: 'rejected', status: 'rejected', guest_count: 5, start_time: eightPm.startIso, end_time: eightPm.endIso }),
    bookingRow({ id: 'refunded', status: 'refunded', guest_count: 5, start_time: eightPm.startIso, end_time: eightPm.endIso }),
    bookingRow({ id: 'abandoned', status: 'abandoned', guest_count: 5, start_time: eightPm.startIso, end_time: eightPm.endIso }),
    bookingRow({
      id: 'expired-pending',
      status: 'pending',
      guest_count: 5,
      expires_at: new Date(Date.now() - 60_000).toISOString(),
      start_time: eightPm.startIso,
      end_time: eightPm.endIso,
    }),
    bookingRow({
      id: 'expired-hold',
      status: 'hold',
      guest_count: 5,
      hold_expires_at: new Date(Date.now() - 60_000).toISOString(),
      start_time: eightPm.startIso,
      end_time: eightPm.endIso,
    }),
  ];
  for (const row of ignoredRows) {
    assert.strictEqual(bookingRowBlocksSlot(row), false, `${row.id} should not protect capacity`);
  }
  result = capacityForSlot(ignoredRows, eightPm, 4);
  assert.strictEqual(result.available, true);
  assert.strictEqual(result.capacity.remaining, 5);

  const activeHold = bookingRow({
    id: 'active-hold',
    status: 'hold',
    guest_count: 2,
    hold_expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    start_time: eightPm.startIso,
    end_time: eightPm.endIso,
  });
  result = capacityForSlot([activeHold], eightPm, 3);
  assert.strictEqual(result.available, true);
  assert.strictEqual(result.capacity.remaining, 3);
  assert.strictEqual(result.capacity.remainingAfter, 0);

  const midnight = slotForOperatingNight('2026-10-11', '00:00');
  assert.strictEqual(midnight.localStart, '2026-10-12 00:00');
  result = capacityForSlot(
    [
      bookingRow({ id: 'previous-date', guest_count: 5, start_time: localToUtcIso('2026-10-10T20:00'), end_time: localToUtcIso('2026-10-10T21:00') }),
      bookingRow({ id: 'next-date', guest_count: 5, start_time: localToUtcIso('2026-10-12T20:00'), end_time: localToUtcIso('2026-10-12T21:00') }),
      bookingRow({ id: 'other-time', guest_count: 5, start_time: eightPm.startIso, end_time: eightPm.endIso }),
      bookingRow({ id: 'other-boat', boat_id: OTHER_BOAT_ID, guest_count: 5, start_time: midnight.startIso, end_time: midnight.endIso }),
      bookingRow({ id: 'other-boat-rental', boat_id: OTHER_BOAT_ID, booking_type: 'rental', guest_count: 1, start_time: midnight.startIso, end_time: midnight.endIso }),
    ],
    midnight,
    4
  );
  assert.strictEqual(result.available, true);
  assert.strictEqual(result.capacity.remaining, 5);

  console.log('bioAvailabilityRemainingSeats.test.js: all tests passed');
}

run();
