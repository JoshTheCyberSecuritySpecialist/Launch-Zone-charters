'use strict';

/**
 * Phase 4 — one-time / rerunnable rental-hold & rental-block cleanup helpers.
 *
 * Safe by design:
 * - Default callers must dry-run.
 * - Never deletes paid/confirmed/charter/groupon/active-hold rows.
 * - Prefer status cancel / soft-disable over hard delete where possible.
 * - blocked_dates with block_scope = 'all' and admin_calendar_items are
 *   reported for manual review only (cannot safely distinguish rental vs charter).
 */

const checkoutHoldService = require('./checkoutHoldService');

const HOLD_SELECT =
  'id, status, payment_status, booking_type, booking_source, staff_created, boat_id, start_time, end_time, expires_at, hold_expires_at, stripe_checkout_session_id, checkout_session_id, stripe_payment_id, payment_intent_id, deposit_paid, amount_collected, groupon_voucher_id, admin_notes, customers(full_name), boats(name)';

const BLOCK_SELECT =
  'id, boat_id, start_time, end_time, block_scope, block_source, title, reason, notes, location, boats(name)';

function asIso(value = Date.now()) {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : new Date().toISOString();
}

function isRentalBookingRow(row) {
  const t = String(row?.booking_type || '').trim().toLowerCase();
  // Historical rows may omit booking_type; only treat explicit charter as non-rental.
  return t !== 'charter';
}

function isCharterBookingRow(row) {
  return String(row?.booking_type || '').trim().toLowerCase() === 'charter';
}

function isAlreadyCancelled(row) {
  return String(row?.status || '').trim().toLowerCase() === 'cancelled';
}

function summarizeHold(row, reason) {
  return {
    id: row.id,
    type: 'booking_hold',
    booking_type: row.booking_type || null,
    status: row.status,
    payment_status: row.payment_status,
    booking_source: row.booking_source || null,
    staff_created: Boolean(row.staff_created),
    boat_id: row.boat_id || null,
    boat_name: Array.isArray(row.boats) ? row.boats[0]?.name : row.boats?.name || null,
    start_time: row.start_time,
    end_time: row.end_time,
    expires_at: row.expires_at || null,
    hold_expires_at: row.hold_expires_at || null,
    stripe_checkout_session_id: row.stripe_checkout_session_id || row.checkout_session_id || null,
    reason,
  };
}

function summarizeBlock(row, reason) {
  return {
    id: row.id,
    type: 'blocked_dates',
    block_scope: row.block_scope || 'all',
    block_source: row.block_source || null,
    title: row.title || null,
    boat_id: row.boat_id || null,
    boat_name: Array.isArray(row.boats) ? row.boats[0]?.name : row.boats?.name || null,
    start_time: row.start_time,
    end_time: row.end_time,
    location: row.location || null,
    reason,
  };
}

/**
 * Scan candidates. Never mutates.
 */
async function scanRentalCleanupCandidates(supabase, { now = Date.now() } = {}) {
  const nowIso = asIso(now);
  const candidates = {
    expiredCheckoutHolds: [],
    expiredStaffHolds: [],
    pastRentalScopedBlocks: [],
  };
  const manualReview = {
    blockScopeAll: [],
    adminCalendarBlockingItems: [],
    skippedProtected: [],
  };
  const errors = [];

  // --- Website checkout holds (pending + expires_at) ---
  {
    const { data, error } = await supabase
      .from('bookings')
      .select(HOLD_SELECT)
      .eq('status', 'pending')
      .not('expires_at', 'is', null)
      .lt('expires_at', nowIso)
      .limit(500);
    if (error) {
      errors.push({ step: 'scan_checkout_holds', message: error.message });
    } else {
      for (const row of data || []) {
        if (isCharterBookingRow(row)) {
          manualReview.skippedProtected.push({
            id: row.id,
            reason: 'charter_booking_excluded',
          });
          continue;
        }
        if (!isRentalBookingRow(row)) continue;
        if (row.groupon_voucher_id) {
          manualReview.skippedProtected.push({
            id: row.id,
            reason: 'groupon_voucher_linked',
          });
          continue;
        }
        if (!checkoutHoldService.isExpiredCheckoutHold(row, now)) {
          manualReview.skippedProtected.push({
            id: row.id,
            reason: 'not_unpaid_website_checkout_hold',
          });
          continue;
        }
        candidates.expiredCheckoutHolds.push(
          summarizeHold(row, 'expired_unpaid_website_checkout_hold')
        );
      }
    }
  }

  // --- Staff holds (status=hold + hold_expires_at) ---
  {
    const { data, error } = await supabase
      .from('bookings')
      .select(HOLD_SELECT)
      .eq('status', 'hold')
      .not('hold_expires_at', 'is', null)
      .lt('hold_expires_at', nowIso)
      .limit(500);
    if (error) {
      errors.push({ step: 'scan_staff_holds', message: error.message });
    } else {
      for (const row of data || []) {
        if (isCharterBookingRow(row)) {
          manualReview.skippedProtected.push({
            id: row.id,
            reason: 'charter_staff_hold_excluded',
          });
          continue;
        }
        if (!isRentalBookingRow(row)) continue;
        if (checkoutHoldService.isPaidLike(row)) {
          manualReview.skippedProtected.push({
            id: row.id,
            reason: 'paid_like_staff_hold_excluded',
          });
          continue;
        }
        if (row.groupon_voucher_id) {
          manualReview.skippedProtected.push({
            id: row.id,
            reason: 'groupon_voucher_linked',
          });
          continue;
        }
        candidates.expiredStaffHolds.push(summarizeHold(row, 'expired_staff_rental_hold'));
      }
    }
  }

  // --- blocked_dates: rental scope only (past end) ---
  {
    const { data, error } = await supabase
      .from('blocked_dates')
      .select(BLOCK_SELECT)
      .eq('block_scope', 'rental')
      .lt('end_time', nowIso)
      .limit(500);
    if (error) {
      errors.push({ step: 'scan_rental_blocks', message: error.message });
    } else {
      for (const row of data || []) {
        candidates.pastRentalScopedBlocks.push(
          summarizeBlock(row, 'past_rental_scoped_blocked_date')
        );
      }
    }
  }

  // --- Manual review: block_scope=all (shared) ---
  {
    const { data, error } = await supabase
      .from('blocked_dates')
      .select(BLOCK_SELECT)
      .eq('block_scope', 'all')
      .lt('end_time', nowIso)
      .limit(200);
    if (error) {
      errors.push({ step: 'scan_all_scope_blocks', message: error.message });
    } else {
      for (const row of data || []) {
        manualReview.blockScopeAll.push({
          ...summarizeBlock(row, 'block_scope_all_needs_manual_review'),
          note: 'Affects rentals AND charters — not auto-cleared.',
        });
      }
    }
  }

  // --- Manual review: admin_calendar_items (no rental/charter scope) ---
  {
    const { data, error } = await supabase
      .from('admin_calendar_items')
      .select(
        'id, boat_id, start_time, end_time, title, item_type, blocks_availability, reason, notes, completed, boats(name)'
      )
      .eq('blocks_availability', true)
      .eq('completed', false)
      .lt('end_time', nowIso)
      .limit(200);
    if (error) {
      if (!/admin_calendar_items|schema cache|does not exist/i.test(String(error.message || ''))) {
        errors.push({ step: 'scan_admin_calendar_items', message: error.message });
      }
    } else {
      for (const row of data || []) {
        manualReview.adminCalendarBlockingItems.push({
          id: row.id,
          type: 'admin_calendar_items',
          item_type: row.item_type,
          title: row.title,
          boat_id: row.boat_id,
          boat_name: Array.isArray(row.boats) ? row.boats[0]?.name : row.boats?.name || null,
          start_time: row.start_time,
          end_time: row.end_time,
          reason: 'admin_calendar_item_no_rental_charter_scope',
          note: 'No block_scope column — cannot safely auto-clear.',
        });
      }
    }
  }

  const totals = {
    expiredCheckoutHolds: candidates.expiredCheckoutHolds.length,
    expiredStaffHolds: candidates.expiredStaffHolds.length,
    pastRentalScopedBlocks: candidates.pastRentalScopedBlocks.length,
    actionable:
      candidates.expiredCheckoutHolds.length +
      candidates.expiredStaffHolds.length +
      candidates.pastRentalScopedBlocks.length,
    manualReviewBlockScopeAll: manualReview.blockScopeAll.length,
    manualReviewAdminCalendar: manualReview.adminCalendarBlockingItems.length,
    skippedProtected: manualReview.skippedProtected.length,
  };

  return {
    dryRun: true,
    scannedAt: nowIso,
    candidates,
    manualReview,
    totals,
    errors,
  };
}

async function cancelBookingRows(supabase, rows, noteReason, nowIso) {
  const ids = [];
  const failures = [];
  for (const row of rows) {
    const { data: existing, error: fetchErr } = await supabase
      .from('bookings')
      .select(HOLD_SELECT)
      .eq('id', row.id)
      .maybeSingle();
    if (fetchErr || !existing) {
      failures.push({ id: row.id, error: fetchErr?.message || 'not_found' });
      continue;
    }
    if (isCharterBookingRow(existing) || isAlreadyCancelled(existing)) {
      failures.push({ id: row.id, error: 'skipped_protected_or_already_cancelled' });
      continue;
    }
    if (noteReason === 'expired_checkout_hold') {
      if (!checkoutHoldService.isExpiredCheckoutHold(existing, Date.parse(nowIso))) {
        failures.push({ id: row.id, error: 'no_longer_qualifies' });
        continue;
      }
      const result = await checkoutHoldService.releaseUnpaidCheckoutHold(supabase, {
        bookingId: existing.id,
        sessionId: existing.stripe_checkout_session_id || existing.checkout_session_id,
        reason: 'phase4_expired_rental_checkout_hold',
        now: nowIso,
      });
      if (result.ids?.length) ids.push(...result.ids);
      else failures.push({ id: row.id, error: result.error?.message || 'release_failed' });
      continue;
    }

    // Staff hold cancel
    if (String(existing.status).toLowerCase() !== 'hold') {
      failures.push({ id: row.id, error: 'status_changed' });
      continue;
    }
    if (checkoutHoldService.isPaidLike(existing)) {
      failures.push({ id: row.id, error: 'paid_like' });
      continue;
    }
    const existingNotes = String(existing.admin_notes || '').trim();
    const note = `[${nowIso}] Phase 4 cancelled expired rental staff hold (${noteReason}).`;
    const { error: updErr } = await supabase
      .from('bookings')
      .update({
        status: 'cancelled',
        admin_notes: existingNotes ? `${existingNotes}\n${note}` : note,
      })
      .eq('id', existing.id)
      .eq('status', 'hold');
    if (updErr) failures.push({ id: row.id, error: updErr.message });
    else ids.push(existing.id);
  }
  return { ids, failures };
}

async function disablePastRentalBlocks(supabase, rows, nowIso) {
  const ids = [];
  const failures = [];
  for (const row of rows) {
    const { data: existing, error: fetchErr } = await supabase
      .from('blocked_dates')
      .select(BLOCK_SELECT)
      .eq('id', row.id)
      .eq('block_scope', 'rental')
      .maybeSingle();
    if (fetchErr || !existing) {
      failures.push({ id: row.id, error: fetchErr?.message || 'not_found_or_not_rental_scope' });
      continue;
    }
    if (String(existing.block_scope || '') !== 'rental') {
      failures.push({ id: row.id, error: 'scope_changed' });
      continue;
    }
    if (!(new Date(String(existing.end_time)).getTime() < Date.parse(nowIso))) {
      failures.push({ id: row.id, error: 'no_longer_past' });
      continue;
    }
    // No inactive column on blocked_dates — hard-delete only past rental-scoped rows.
    const { error: delErr } = await supabase
      .from('blocked_dates')
      .delete()
      .eq('id', existing.id)
      .eq('block_scope', 'rental');
    if (delErr) failures.push({ id: row.id, error: delErr.message });
    else ids.push(existing.id);
  }
  return { ids, failures };
}

/**
 * Execute only previously scanned actionable candidates.
 * Re-validates each row before mutation.
 */
async function executeRentalCleanup(supabase, scanResult, { now = Date.now() } = {}) {
  const nowIso = asIso(now);
  const checkout = await cancelBookingRows(
    supabase,
    scanResult.candidates.expiredCheckoutHolds || [],
    'expired_checkout_hold',
    nowIso
  );
  const staff = await cancelBookingRows(
    supabase,
    scanResult.candidates.expiredStaffHolds || [],
    'expired_staff_hold',
    nowIso
  );
  const blocks = await disablePastRentalBlocks(
    supabase,
    scanResult.candidates.pastRentalScopedBlocks || [],
    nowIso
  );

  return {
    dryRun: false,
    executedAt: nowIso,
    cancelledCheckoutHolds: checkout.ids,
    cancelledStaffHolds: staff.ids,
    archivedRentalBlocks: blocks.ids,
    failures: [...checkout.failures, ...staff.failures, ...blocks.failures],
    counts: {
      cancelledCheckoutHolds: checkout.ids.length,
      cancelledStaffHolds: staff.ids.length,
      deletedPastRentalBlocks: blocks.ids.length,
    },
  };
}

module.exports = {
  scanRentalCleanupCandidates,
  executeRentalCleanup,
  isRentalBookingRow,
  isCharterBookingRow,
};
