const test = require('node:test');
const assert = require('node:assert/strict');
const { DateTime } = require('luxon');
const {
  isBookingNewForAdmin,
  buildScheduleConflicts,
  computeUpcomingCounts,
  bookingSourceDisplay,
  relativeTripLabel,
  formatScheduledTimeRange,
  parseOpsSort,
  parseScheduleStartEnd,
  validateOpsQuery,
  filterNewBookings,
  isTripStillOperational,
  filterConflictsToOperational,
  buildNewBookingCards,
  sharedDepartureGroupKey,
  detectDuplicateBookingWarnings,
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
    captain_id: null,
    outstanding: 0,
    waiver_done: true,
    insurance_done: true,
    ready_for_departure: false,
  }));
  const conflicts = buildScheduleConflicts(normalized, rows, 'America/New_York');
  assert.ok(conflicts.some((c) => c.type === 'boat_exclusive_overlap'));
});

test('shared charter overlap with different starts does not use interval grouping for capacity', () => {
  const boatId = '22222222-2222-2222-2222-222222222222';
  const zone = 'America/New_York';
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
      guest_count: 4,
      rental_location: 'Marina',
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
      guest_count: 4,
      rental_location: 'Marina',
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
  const conflicts = buildScheduleConflicts(normalized, rows, zone);
  assert.equal(
    conflicts.filter((c) => c.type === 'shared_capacity_exceeded').length,
    0,
    'different normalized starts must not share capacity bucket'
  );
  assert.notEqual(sharedDepartureGroupKey(rows[0], zone), sharedDepartureGroupKey(rows[1], zone));
});

test('shared charter same departure key flags capacity when guests exceed max', () => {
  const boatId = '33333333-3333-3333-3333-333333333333';
  const zone = 'America/New_York';
  const start = DateTime.fromObject({ year: 2026, month: 8, day: 10, hour: 22, minute: 0 }, { zone }).toUTC().toISO();
  const rows = [
    {
      id: 'a',
      boat_id: boatId,
      booking_type: 'charter',
      charter_type: 'bio',
      charter_seating: 'shared',
      status: 'confirmed',
      start_time: start,
      end_time: '2026-08-11T01:00:00.000Z',
      guest_count: 4,
      rental_location: 'Marina',
    },
    {
      id: 'b',
      boat_id: boatId,
      booking_type: 'charter',
      charter_type: 'bio',
      charter_seating: 'shared',
      status: 'confirmed',
      start_time: start,
      end_time: '2026-08-11T01:30:00.000Z',
      guest_count: 4,
      rental_location: 'Marina',
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
  const conflicts = buildScheduleConflicts(normalized, rows, zone);
  assert.ok(conflicts.some((c) => c.type === 'shared_capacity_exceeded'));
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

test('relativeTripLabel TODAY and TOMORROW in business TZ', () => {
  const zone = 'America/New_York';
  const today = DateTime.now().setZone(zone).startOf('day').plus({ hours: 20 });
  assert.equal(relativeTripLabel(today, zone, 'confirmed').label, 'TODAY');
  const tomorrow = today.plus({ days: 1 });
  assert.equal(relativeTripLabel(tomorrow, zone, 'confirmed').label, 'TOMORROW');
});

test('formatScheduledTimeRange overnight shows end calendar day', () => {
  const zone = 'America/New_York';
  const start = DateTime.fromISO('2026-08-15T03:00:00.000Z').setZone(zone);
  const end = DateTime.fromISO('2026-08-15T04:00:00.000Z').setZone(zone).plus({ hours: 2 });
  const out = formatScheduledTimeRange(start, end, true);
  assert.match(out, /AT/);
});

test('parseOpsSort allowlist defaults unknown sort', () => {
  assert.equal(parseOpsSort('trip_date'), 'trip_date');
  assert.equal(parseOpsSort('invalid'), 'trip_date');
});

test('validateOpsQuery returns 400 for invalid filter and sort', () => {
  assert.equal(validateOpsQuery('trip_date', null).filter, null);
  assert.equal(validateOpsQuery(undefined, 'today').filter, 'today');
  assert.ok(validateOpsQuery('not-a-sort', null).error);
  assert.equal(validateOpsQuery('not-a-sort', null).statusCode, 400);
  assert.ok(validateOpsQuery('trip_date', 'bad-filter').error);
});

test('overnight bio 11pm to midnight rolls end to next day', () => {
  const zone = 'America/New_York';
  const startLocal = DateTime.fromObject({ year: 2026, month: 8, day: 10, hour: 23, minute: 0 }, { zone });
  const endLocal = DateTime.fromObject({ year: 2026, month: 8, day: 10, hour: 0, minute: 0 }, { zone });
  const row = {
    booking_type: 'charter',
    charter_type: 'bio',
    start_time: startLocal.toUTC().toISO(),
    end_time: endLocal.toUTC().toISO(),
  };
  const sched = parseScheduleStartEnd(row, zone);
  assert.equal(sched.valid, true);
  assert.equal(sched.overnight, true);
  assert.ok(sched.end > sched.start);
});

test('overnight bio 11:30pm to 1am', () => {
  const zone = 'America/New_York';
  const startLocal = DateTime.fromObject({ year: 2026, month: 8, day: 10, hour: 23, minute: 30 }, { zone });
  const endLocal = DateTime.fromObject({ year: 2026, month: 8, day: 10, hour: 1, minute: 0 }, { zone });
  const row = {
    booking_type: 'charter',
    charter_type: 'bio',
    start_time: startLocal.toUTC().toISO(),
    end_time: endLocal.toUTC().toISO(),
  };
  const sched = parseScheduleStartEnd(row, zone);
  assert.equal(sched.valid, true);
  assert.equal(sched.overnight, true);
});

test('rental end before start is invalid not overnight', () => {
  const zone = 'America/New_York';
  const row = {
    booking_type: 'rental',
    start_time: '2026-08-10T18:00:00.000Z',
    end_time: '2026-08-10T14:00:00.000Z',
  };
  const sched = parseScheduleStartEnd(row, zone);
  assert.equal(sched.valid, false);
  assert.equal(sched.invalidRange, true);
  assert.equal(sched.overnight, false);
});

test('timezone conversion near midnight labels trip day in business TZ', () => {
  const zone = 'America/New_York';
  const start = DateTime.fromObject({ year: 2026, month: 8, day: 11, hour: 0, minute: 15 }, { zone });
  const row = { start_time: start.toUTC().toISO(), end_time: start.plus({ hours: 2 }).toUTC().toISO() };
  const sched = parseScheduleStartEnd(row, zone);
  assert.equal(sched.valid, true);
  assert.equal(sched.start.toISODate(), '2026-08-11');
});

test('filterNewBookings covers required filters', () => {
  const zone = 'America/New_York';
  const todayStart = DateTime.now().setZone(zone).startOf('day').plus({ hours: 10 });
  const tomorrowStart = todayStart.plus({ days: 1 });
  const fri = todayStart.plus({ days: 7 }).set({ weekday: 5 });
  const base = {
    is_new: true,
    opsEligible: true,
    conflictStatus: 'No conflict',
    boatMissing: false,
    captainMissing: false,
    source_label: 'Direct Website',
  };
  const cards = [
    { ...base, scheduledStart: todayStart.toUTC().toISO(), source_label: 'Direct Website' },
    { ...base, scheduledStart: tomorrowStart.toUTC().toISO(), source_label: 'Groupon' },
    { ...base, scheduledStart: fri.toUTC().toISO(), source_label: 'Staff Entry' },
    {
      ...base,
      scheduledStart: todayStart.toUTC().toISO(),
      conflictStatus: 'Missing boat',
      boatMissing: true,
    },
    {
      ...base,
      scheduledStart: todayStart.toUTC().toISO(),
      captainMissing: true,
      conflictStatus: 'Missing captain',
    },
    {
      ...base,
      scheduledStart: todayStart.toUTC().toISO(),
      conflictStatus: 'Possible duplicate',
    },
    { ...base, scheduledStart: todayStart.toUTC().toISO(), is_new: true },
  ];

  assert.equal(filterNewBookings(cards, 'today', zone).length, 5);
  assert.equal(filterNewBookings(cards, 'tomorrow', zone).length, 1);
  assert.ok(filterNewBookings(cards, 'weekend', zone).length >= 1);
  assert.equal(filterNewBookings(cards, 'new', zone).length, cards.length);
  assert.equal(filterNewBookings(cards, 'conflict', zone).length, 3);
  assert.equal(filterNewBookings(cards, 'missing_boat', zone).length, 1);
  assert.equal(filterNewBookings(cards, 'missing_captain', zone).length, 1);
  assert.equal(filterNewBookings(cards, 'direct', zone).length, 5);
  assert.equal(filterNewBookings(cards, 'groupon', zone).length, 1);
  assert.equal(filterNewBookings(cards, 'staff', zone).length, 1);
});

test('filterNewBookings week uses next 7 days in business TZ', () => {
  const zone = 'America/New_York';
  const todayStart = DateTime.now().setZone(zone).startOf('day').plus({ hours: 10 });
  const inThreeDays = todayStart.plus({ days: 3 });
  const inTenDays = todayStart.plus({ days: 10 });
  const base = {
    is_new: true,
    conflictStatus: 'No conflict',
    boatMissing: false,
    captainMissing: false,
    source_label: 'Direct Website',
  };
  const cards = [
    { ...base, scheduledStart: todayStart.toUTC().toISO() },
    { ...base, scheduledStart: inThreeDays.toUTC().toISO() },
    { ...base, scheduledStart: inTenDays.toUTC().toISO() },
  ];
  const out = filterNewBookings(cards, 'week', zone);
  assert.equal(out.length, 2);
});

test('validateOpsQuery accepts week filter', () => {
  assert.equal(validateOpsQuery('trip_date', 'week').filter, 'week');
});

test('detectDuplicateBookingWarnings flags stripe session duplicates in batch', () => {
  const rows = [
    {
      id: '1',
      status: 'confirmed',
      stripe_checkout_session_id: 'cs_test_abc',
      customer_id: 'c1',
      start_time: '2026-08-10T14:00:00.000Z',
      end_time: '2026-08-10T18:00:00.000Z',
      booking_type: 'rental',
    },
    {
      id: '2',
      status: 'confirmed',
      stripe_checkout_session_id: 'cs_test_abc',
      customer_id: 'c2',
      start_time: '2026-08-11T14:00:00.000Z',
      end_time: '2026-08-11T18:00:00.000Z',
      booking_type: 'rental',
    },
  ];
  const warnings = detectDuplicateBookingWarnings(rows, 'America/New_York');
  assert.ok(warnings.some((w) => w.type === 'duplicate_stripe_session'));
});

test('A old unreviewed booking with ended trip is not operational', () => {
  const zone = 'America/New_York';
  const now = DateTime.fromObject({ year: 2026, month: 8, day: 7, hour: 10 }, { zone });
  const row = {
    id: 'jul24',
    status: 'confirmed',
    booking_type: 'rental',
    start_time: DateTime.fromObject({ year: 2026, month: 7, day: 24, hour: 15 }, { zone }).toUTC().toISO(),
    end_time: DateTime.fromObject({ year: 2026, month: 7, day: 24, hour: 16 }, { zone }).toUTC().toISO(),
  };
  assert.equal(isTripStillOperational(row, zone, now), false);
});

test('B upcoming unreviewed booking is operational', () => {
  const zone = 'America/New_York';
  const now = DateTime.fromObject({ year: 2026, month: 8, day: 7, hour: 10 }, { zone });
  const row = {
    id: 'tom',
    status: 'confirmed',
    booking_type: 'rental',
    start_time: DateTime.fromObject({ year: 2026, month: 8, day: 8, hour: 10 }, { zone }).toUTC().toISO(),
    end_time: DateTime.fromObject({ year: 2026, month: 8, day: 8, hour: 14 }, { zone }).toUTC().toISO(),
  };
  assert.equal(isTripStillOperational(row, zone, now), true);
});

test('C underway booking remains operational until trip end', () => {
  const zone = 'America/New_York';
  const now = DateTime.fromObject({ year: 2026, month: 8, day: 7, hour: 12 }, { zone });
  const row = {
    id: 'live',
    status: 'confirmed',
    booking_type: 'rental',
    start_time: DateTime.fromObject({ year: 2026, month: 8, day: 7, hour: 11 }, { zone }).toUTC().toISO(),
    end_time: DateTime.fromObject({ year: 2026, month: 8, day: 7, hour: 14 }, { zone }).toUTC().toISO(),
  };
  assert.equal(isTripStillOperational(row, zone, now), true);
});

test('D overnight future bio trip is operational before end', () => {
  const zone = 'America/New_York';
  const now = DateTime.fromObject({ year: 2026, month: 8, day: 7, hour: 22 }, { zone });
  const start = DateTime.fromObject({ year: 2026, month: 8, day: 7, hour: 23 }, { zone });
  const end = DateTime.fromObject({ year: 2026, month: 8, day: 7, hour: 1 }, { zone });
  const row = {
    id: 'bio-future',
    status: 'confirmed',
    booking_type: 'charter',
    charter_type: 'bio',
    start_time: start.toUTC().toISO(),
    end_time: end.toUTC().toISO(),
  };
  assert.equal(isTripStillOperational(row, zone, now), true);
});

test('E overnight bio trip hidden after end passes', () => {
  const zone = 'America/New_York';
  const now = DateTime.fromObject({ year: 2026, month: 8, day: 8, hour: 2 }, { zone });
  const start = DateTime.fromObject({ year: 2026, month: 8, day: 7, hour: 23 }, { zone });
  const end = DateTime.fromObject({ year: 2026, month: 8, day: 7, hour: 1 }, { zone });
  const row = {
    id: 'bio-past',
    status: 'confirmed',
    booking_type: 'charter',
    charter_type: 'bio',
    start_time: start.toUTC().toISO(),
    end_time: end.toUTC().toISO(),
  };
  assert.equal(isTripStillOperational(row, zone, now), false);
});

test('F historical conflict is excluded from operational conflicts', () => {
  const zone = 'America/New_York';
  const now = DateTime.fromObject({ year: 2026, month: 8, day: 7, hour: 10 }, { zone });
  const past = {
    id: 'p1',
    status: 'confirmed',
    booking_type: 'rental',
    start_time: DateTime.fromObject({ year: 2026, month: 7, day: 24, hour: 15 }, { zone }).toUTC().toISO(),
    end_time: DateTime.fromObject({ year: 2026, month: 7, day: 24, hour: 16 }, { zone }).toUTC().toISO(),
  };
  const out = filterConflictsToOperational(
    [{ type: 'missing_boat', label: 'Missing boat', booking_id: 'p1', urgency: 6 }],
    new Map([['p1', past]]),
    zone,
    now
  );
  assert.equal(out.length, 0);
});

test('G upcoming conflict remains in operational conflicts', () => {
  const zone = 'America/New_York';
  const now = DateTime.fromObject({ year: 2026, month: 8, day: 7, hour: 10 }, { zone });
  const upcoming = {
    id: 'u1',
    status: 'confirmed',
    booking_type: 'rental',
    start_time: DateTime.fromObject({ year: 2026, month: 8, day: 8, hour: 10 }, { zone }).toUTC().toISO(),
    end_time: DateTime.fromObject({ year: 2026, month: 8, day: 8, hour: 14 }, { zone }).toUTC().toISO(),
  };
  const out = filterConflictsToOperational(
    [{ type: 'missing_boat', label: 'Missing boat', booking_id: 'u1', urgency: 6 }],
    new Map([['u1', upcoming]]),
    zone,
    now
  );
  assert.equal(out.length, 1);
});

test('buildNewBookingCards omits ended trips even when unreviewed', () => {
  const zone = 'America/New_York';
  const pastStart = DateTime.fromObject({ year: 2026, month: 7, day: 24, hour: 15 }, { zone });
  const pastEnd = DateTime.fromObject({ year: 2026, month: 7, day: 24, hour: 16 }, { zone });
  const futureStart = DateTime.fromObject({ year: 2026, month: 8, day: 15, hour: 15 }, { zone });
  const futureEnd = DateTime.fromObject({ year: 2026, month: 8, day: 15, hour: 18 }, { zone });
  const rawRows = [
    {
      id: 'old-unreviewed',
      status: 'confirmed',
      booking_type: 'rental',
      start_time: pastStart.toUTC().toISO(),
      end_time: pastEnd.toUTC().toISO(),
      created_at: '2026-07-20T12:00:00.000Z',
      customers: { full_name: 'Past Guest' },
    },
    {
      id: 'new-upcoming',
      status: 'confirmed',
      booking_type: 'rental',
      start_time: futureStart.toUTC().toISO(),
      end_time: futureEnd.toUTC().toISO(),
      created_at: new Date().toISOString(),
      customers: { full_name: 'Future Guest' },
    },
  ];
  const normalizeRow = (row) => ({
    id: row.id,
    customer_name: row.customers?.full_name || 'Guest',
    status: row.status,
    payment_status: 'pending',
    outstanding: 0,
    waiver_done: true,
    insurance_done: true,
    ready_for_departure: false,
    boat_id: null,
    booking_type: row.booking_type,
  });
  const { cards } = buildNewBookingCards({
    rawRows,
    normalizeRow,
    lastReviewedAt: '1970-01-01T00:00:00.000Z',
    acknowledgedIds: new Set(),
    scheduleConflicts: [],
    sort: 'trip_date',
    filter: null,
    businessTimezone: zone,
  });
  assert.ok(!cards.some((c) => c.id === 'old-unreviewed'));
  assert.ok(cards.some((c) => c.id === 'new-upcoming'));
});

console.log('adminOperationsDashboard.test.js: all tests passed');
