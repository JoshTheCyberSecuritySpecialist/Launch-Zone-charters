const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isBookingNewForAdmin,
  buildScheduleConflicts,
  computeUpcomingCounts,
  bookingSourceDisplay,
} = require('../services/adminOperationsDashboardService');

test('isBookingNewForAdmin respects last reviewed and acknowledgements', () => {
  const ack = new Set(['b-old']);
  assert.equal(
    isBookingNewForAdmin({ id: 'b1', created_at: '2026-08-06T12:00:00.000Z' }, '2026-08-06T10:00:00.000Z', ack),
    true
  );
  assert.equal(
    isBookingNewForAdmin({ id: 'b-old', created_at: '2026-08-06T12:00:00.000Z' }, '2026-08-06T10:00:00.000Z', ack),
    false
  );
  assert.equal(
    isBookingNewForAdmin({ id: 'b2', created_at: '2026-08-05T12:00:00.000Z' }, '2026-08-06T10:00:00.000Z', new Set()),
    false
  );
});

test('bookingSourceDisplay labels', () => {
  assert.equal(bookingSourceDisplay({ booking_source: 'groupon' }), 'Groupon');
  assert.equal(bookingSourceDisplay({ booking_source: 'website' }), 'Direct Website');
  assert.equal(bookingSourceDisplay({ staff_created: true }), 'Staff Entry');
});

test('detects exclusive boat overlap conflict', () => {
  const boatId = '11111111-1111-1111-1111-111111111111';
  const rows = [
    {
      id: 'a',
      boat_id: boatId,
      booking_type: 'rental',
      status: 'confirmed',
      start_time: '2026-08-10T14:00:00.000Z',
      end_time: '2026-08-10T18:00:00.000Z',
      guest_count: 2,
    },
    {
      id: 'b',
      boat_id: boatId,
      booking_type: 'rental',
      status: 'confirmed',
      start_time: '2026-08-10T16:00:00.000Z',
      end_time: '2026-08-10T20:00:00.000Z',
      guest_count: 2,
    },
  ];
  const normalized = rows.map((r) => ({
    ...r,
    status: r.status,
    boat_id: r.boat_id,
    booking_type: r.booking_type,
    captain_id: null,
    start_time: r.start_time,
    end_time: r.end_time,
    outstanding: 0,
    waiver_done: true,
    insurance_done: true,
    ready_for_departure: false,
  }));
  const conflicts = buildScheduleConflicts(normalized, rows);
  assert.ok(conflicts.some((c) => c.type === 'boat_exclusive_overlap'));
});

test('shared charter overlap within capacity does not exclusive-conflict', () => {
  const boatId = '22222222-2222-2222-2222-222222222222';
  const rows = [
    {
      id: 's1',
      boat_id: boatId,
      booking_type: 'charter',
      charter_type: 'bio',
      charter_seating: 'shared',
      status: 'confirmed',
      start_time: '2026-08-10T22:00:00.000Z',
      end_time: '2026-08-11T01:00:00.000Z',
      guest_count: 2,
    },
    {
      id: 's2',
      boat_id: boatId,
      booking_type: 'charter',
      charter_type: 'bio',
      charter_seating: 'shared',
      status: 'confirmed',
      start_time: '2026-08-10T22:30:00.000Z',
      end_time: '2026-08-11T01:30:00.000Z',
      guest_count: 2,
    },
  ];
  const normalized = rows.map((r) => ({
    ...r,
    captain_id: 'cap-1',
    outstanding: 0,
    waiver_done: true,
    insurance_done: true,
    ready_for_departure: false,
  }));
  const conflicts = buildScheduleConflicts(normalized, rows);
  assert.equal(conflicts.filter((c) => c.type === 'boat_exclusive_overlap').length, 0);
});

test('computeUpcomingCounts buckets by business timezone', () => {
  const zone = 'America/New_York';
  const rows = [
    { status: 'confirmed', start_time: '2026-08-06T15:00:00.000Z' },
    { status: 'confirmed', start_time: '2026-08-07T15:00:00.000Z' },
    { status: 'cancelled', start_time: '2026-08-06T16:00:00.000Z' },
  ];
  const out = computeUpcomingCounts(rows, zone);
  assert.ok(typeof out.today === 'number');
  assert.ok(typeof out.tomorrow === 'number');
  assert.ok(out.nextSevenDays >= 0);
});

console.log('adminOperationsDashboard.test.js: all tests passed');
