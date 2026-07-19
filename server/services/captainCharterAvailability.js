/**
 * Generate charter-only closed intervals for the single-captain schedule.
 * Open windows (not stored as blocks): Mon–Sat 5:00 PM → following day 4:00 AM.
 */
const { DateTime } = require('luxon');
const {
  BUSINESS_TZ,
  charterClosedLocalIntervalsForDay,
} = require('../lib/captainNightSchedule');

const GENERATED_BLOCK_SOURCE = 'charter_captain_availability';
const GENERATED_BLOCK_TITLE = 'Charter Captain Closed';
const GENERATED_BLOCK_REASON = 'Captain unavailable (charters only)';

const BLOCKING_BOOKING_STATUSES = [
  'hold',
  'pending',
  'pending_verification',
  'confirmed',
  'ready_for_departure',
  'completed',
];

function parseDateOnlyInZone(dateStr, zone) {
  const [y, m, d] = String(dateStr || '')
    .split('-')
    .map((n) => Number(n));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  const dt = DateTime.fromObject({ year: y, month: m, day: d }, { zone });
  return dt.isValid ? dt : null;
}

function mergeClosedIntervals(rows) {
  const sorted = (rows || [])
    .map((row) => ({
      startMs: new Date(String(row.startIso)).getTime(),
      endMs: new Date(String(row.endIso)).getTime(),
    }))
    .filter((row) => Number.isFinite(row.startMs) && Number.isFinite(row.endMs) && row.endMs > row.startMs)
    .sort((a, b) => a.startMs - b.startMs);

  const merged = [];
  for (const row of sorted) {
    const last = merged[merged.length - 1];
    if (!last || row.startMs > last.endMs) {
      merged.push({ ...row });
      continue;
    }
    last.endMs = Math.max(last.endMs, row.endMs);
  }

  return merged.map((row) => ({
    startIso: new Date(row.startMs).toISOString(),
    endIso: new Date(row.endMs).toISOString(),
    title: GENERATED_BLOCK_TITLE,
    reason: GENERATED_BLOCK_REASON,
    block_scope: 'charter',
    block_source: GENERATED_BLOCK_SOURCE,
    boat_id: null,
    all_day: false,
    notes: 'Auto-generated charter captain availability block.',
  }));
}

function generateCharterCaptainBlocks(startDateStr, endDateStr) {
  const from = parseDateOnlyInZone(startDateStr, BUSINESS_TZ);
  const to = parseDateOnlyInZone(endDateStr, BUSINESS_TZ);
  if (!from || !to || to < from) {
    throw new Error('Invalid date range.');
  }

  const raw = [];
  let cursor = from.startOf('day');
  const endDay = to.startOf('day');
  while (cursor <= endDay) {
    for (const interval of charterClosedLocalIntervalsForDay(cursor)) {
      if (interval.end <= interval.start) continue;
      raw.push({
        startIso: interval.start.toUTC().toISO(),
        endIso: interval.end.toUTC().toISO(),
      });
    }
    cursor = cursor.plus({ days: 1 });
  }

  return mergeClosedIntervals(raw);
}

function intervalsOverlap(aStartMs, aEndMs, bStartMs, bEndMs) {
  return aStartMs < bEndMs && aEndMs > bStartMs;
}

function bookingRowBlocksSlot(row) {
  if (!row || !BLOCKING_BOOKING_STATUSES.includes(String(row.status || ''))) return false;
  const exp = row.expires_at ? new Date(String(row.expires_at)).getTime() : NaN;
  if (String(row.status) === 'pending' && Number.isFinite(exp) && exp < Date.now()) return false;
  return true;
}

function findCharterConflictsForBlocks(blocks, charterBookings) {
  const conflicts = [];
  for (const booking of charterBookings || []) {
    if (!bookingRowBlocksSlot(booking)) continue;
    const bStart = new Date(String(booking.start_time)).getTime();
    const bEnd = new Date(String(booking.end_time)).getTime();
    if (!Number.isFinite(bStart) || !Number.isFinite(bEnd)) continue;
    for (const block of blocks || []) {
      const blockStart = new Date(String(block.startIso)).getTime();
      const blockEnd = new Date(String(block.endIso)).getTime();
      if (intervalsOverlap(bStart, bEnd, blockStart, blockEnd)) {
        conflicts.push({
          id: booking.id,
          start_time: booking.start_time,
          end_time: booking.end_time,
          status: booking.status,
          charter_type: booking.charter_type || null,
          customer_name:
            (Array.isArray(booking.customers) ? booking.customers[0] : booking.customers)?.full_name ||
            'Charter guest',
        });
        break;
      }
    }
  }
  return conflicts;
}

function defaultQuickRanges(now = DateTime.now().setZone(BUSINESS_TZ)) {
  const nextMonday = now.plus({ weeks: 1 }).startOf('week');
  const nextSunday = nextMonday.plus({ days: 6 });
  const nextMonthStart = now.plus({ months: 1 }).startOf('month');
  const nextMonthEnd = nextMonthStart.endOf('month').startOf('day');
  return {
    nextWeek: {
      startDate: nextMonday.toFormat('yyyy-MM-dd'),
      endDate: nextSunday.toFormat('yyyy-MM-dd'),
    },
    nextMonth: {
      startDate: nextMonthStart.toFormat('yyyy-MM-dd'),
      endDate: nextMonthEnd.toFormat('yyyy-MM-dd'),
    },
  };
}

module.exports = {
  BUSINESS_TZ,
  GENERATED_BLOCK_SOURCE,
  GENERATED_BLOCK_TITLE,
  generateCharterCaptainBlocks,
  findCharterConflictsForBlocks,
  charterClosedLocalIntervalsForDay,
  defaultQuickRanges,
  parseDateOnlyInZone,
};
