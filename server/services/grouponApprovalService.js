/**
 * Admin approval workflow for pending Groupon booking requests.
 */
const availabilityService = require('./availabilityService');
const boatCapacityService = require('./boatCapacityService');
const bookingReliability = require('./bookingReliability');
const { isSharedCharterBooking } = require('../lib/sharedCharterCapacity');
const { markVoucherBooked, releaseVoucherPendingBooking } = require('./grouponVoucherReservationService');
const { evaluateGrouponVoucherEligibility } = require('./grouponVoucherEligibilityService');
const bookingCommunications = require('./bookingCommunications');

const {
  APPROVABLE_STATUSES,
  REJECT_REASONS,
  isGrouponPendingBooking,
} = require('./grouponApprovalConstants');

function charterNeedsCaptain(booking) {
  return String(booking.booking_type || '') === 'charter';
}

function rentalNeedsBoat(booking) {
  return String(booking.booking_type || '') !== 'charter';
}

async function loadGrouponBookingContext(supabase, bookingId) {
  const { data: booking, error } = await supabase
    .from('bookings')
    .select(
      '*, customers(id, full_name, email, phone), boats(id, name), captains(id, full_name), groupon_vouchers(id, voucher_last_four, local_status, booking_id, deal_name, option_name, source_status, redeemed_flag, refunded_at, expires_at, mapping_id, groupon_deal_option_mappings(*))'
    )
    .eq('id', bookingId)
    .maybeSingle();
  if (error) throw error;
  if (!booking?.id) {
    const err = new Error('Booking not found.');
    err.statusCode = 404;
    throw err;
  }

  const customer = Array.isArray(booking.customers) ? booking.customers[0] : booking.customers;
  const voucherRaw = Array.isArray(booking.groupon_vouchers)
    ? booking.groupon_vouchers[0]
    : booking.groupon_vouchers;
  const mapping = voucherRaw?.groupon_deal_option_mappings
    ? Array.isArray(voucherRaw.groupon_deal_option_mappings)
      ? voucherRaw.groupon_deal_option_mappings[0]
      : voucherRaw.groupon_deal_option_mappings
    : null;

  return { booking, customer, voucher: voucherRaw || null, mapping };
}

async function checkGrouponApprovalConflicts(supabase, booking, { excludeBookingId = null, voucher = null, mapping = null } = {}) {
  const conflicts = [];
  const bookingId = excludeBookingId || booking.id;
  const startTime = booking.start_time;
  const endTime = booking.end_time;
  const guestCount = Math.max(1, Number(booking.guest_count || 1));

  if (rentalNeedsBoat(booking) && !booking.boat_id) {
    conflicts.push({ code: 'missing_boat', message: 'Assign a boat before approving this Groupon rental.' });
  }

  if (charterNeedsCaptain(booking) && !booking.captain_id) {
    conflicts.push({ code: 'missing_captain', message: 'Assign a captain before approving this Groupon charter.' });
  }

  let voucherRow = voucher;
  let mappingRow = mapping;
  if (!voucherRow && booking.groupon_voucher_id) {
    const { data } = await supabase
      .from('groupon_vouchers')
      .select('*, groupon_deal_option_mappings(*)')
      .eq('id', booking.groupon_voucher_id)
      .maybeSingle();
    voucherRow = data || null;
    mappingRow = mappingRow
      || (Array.isArray(data?.groupon_deal_option_mappings)
        ? data.groupon_deal_option_mappings[0]
        : data?.groupon_deal_option_mappings);
  }

  if (voucherRow) {
    const eligibility = evaluateGrouponVoucherEligibility(voucherRow, mappingRow, {
      requestedGuestCount: guestCount,
      allowLinkedBookingId: booking.id,
    });
    if (!eligibility.eligible && eligibility.reasonCode !== 'already_booked') {
      conflicts.push({ code: 'voucher_issue', message: eligibility.adminDetail || 'Groupon voucher is not eligible.' });
    }
  }

  try {
    if (String(booking.booking_type || '') === 'charter') {
      await availabilityService.assertUnifiedCharterSlotAvailable({
        startTime,
        endTime,
        charterType: booking.charter_type || 'bio',
        charterVariant: booking.charter_seating === 'private' ? 'private' : 'shared',
        passengerCount: guestCount,
        excludeBookingId: bookingId,
        bookingSource: 'groupon_approval',
      });
    } else if (booking.boat_id) {
      if (isSharedCharterBooking(booking)) {
        await availabilityService.assertSharedCharterSlotAvailable({
          boatId: booking.boat_id,
          startTime,
          endTime,
          passengerCount: guestCount,
          location: booking.rental_location || null,
          excludeBookingId: bookingId,
        });
      } else {
        await availabilityService.assertBookingSlotAvailable({
          boatId: booking.boat_id,
          startTime,
          endTime,
          location: booking.rental_location || null,
          excludeBookingId: bookingId,
        });
      }
    }
  } catch (slotErr) {
    conflicts.push({
      code: slotErr.code || 'slot_unavailable',
      message: slotErr.message || 'Requested time is no longer available.',
      availability: slotErr.availability || null,
    });
  }

  if (booking.boat_id && guestCount) {
    try {
      const cap = await boatCapacityService.getCapacityDetailForBooking(supabase, booking.id);
      if (cap?.overWeight) {
        conflicts.push({
          code: 'weight_limit',
          message: cap.overWeightMessage || 'Group weight exceeds boat limits.',
        });
      }
    } catch {
      // Capacity detail optional during review.
    }
  }

  let alternatives = [];
  if (conflicts.some((c) => ['slot_unavailable', 'lead_time'].includes(String(c.code || '')))) {
    try {
      const { listBookingAlternatives } = require('./adminSupportService');
      alternatives = await listBookingAlternatives(supabase, booking.id, { limit: 6 });
    } catch {
      alternatives = [];
    }
  }

  return {
    ok: conflicts.length === 0,
    conflicts,
    alternatives,
  };
}

async function approveGrouponBooking(supabase, deps, { bookingId, adminUserId, overrideReason = null }) {
  const ctx = await loadGrouponBookingContext(supabase, bookingId);
  const { booking, customer, voucher } = ctx;

  if (!isGrouponPendingBooking(booking)) {
    const err = new Error('This booking is not a pending Groupon request.');
    err.statusCode = 400;
    throw err;
  }

  if (String(booking.status || '') === 'confirmed') {
    return { ok: true, alreadyConfirmed: true, bookingId };
  }

  const conflictCheck = await checkGrouponApprovalConflicts(supabase, booking, {
    voucher,
    mapping: ctx.mapping,
  });
  const blockingAssignments = conflictCheck.conflicts.filter((c) =>
    ['missing_boat', 'missing_captain', 'voucher_issue'].includes(c.code)
  );
  const scheduleConflicts = conflictCheck.conflicts.filter((c) =>
    !['missing_boat', 'missing_captain', 'voucher_issue'].includes(c.code)
  );

  if (blockingAssignments.length > 0) {
    const err = new Error(blockingAssignments.map((c) => c.message).join(' '));
    err.statusCode = 409;
    err.conflicts = conflictCheck.conflicts;
    err.alternatives = conflictCheck.alternatives;
    throw err;
  }

  if (scheduleConflicts.length > 0) {
    if (!overrideReason) {
      const err = new Error(scheduleConflicts.map((c) => c.message).join(' '));
      err.statusCode = 409;
      err.conflicts = conflictCheck.conflicts;
      err.alternatives = conflictCheck.alternatives;
      throw err;
    }
  }

  const voucherId = booking.groupon_voucher_id || voucher?.id;
  if (!voucherId) {
    const err = new Error('No Groupon voucher linked to this booking.');
    err.statusCode = 400;
    throw err;
  }

  const marked = await markVoucherBooked(supabase, {
    voucherId,
    bookingId: booking.id,
    actorType: 'admin',
    actorId: adminUserId,
  });
  if (!marked) {
    const err = new Error('Could not finalize Groupon voucher link.');
    err.statusCode = 409;
    throw err;
  }

  const { error: updateError } = await supabase
    .from('bookings')
    .update({ status: 'confirmed' })
    .eq('id', booking.id);
  if (updateError) {
    const err = new Error(updateError.message || 'Could not confirm booking.');
    err.statusCode = 500;
    throw err;
  }

  await bookingReliability.insertActivity(supabase, {
    booking_id: booking.id,
    event_type: 'groupon_request_approved',
    actor_type: 'admin',
    actor_id: adminUserId,
    message: overrideReason
      ? `Groupon request approved with conflict override: ${overrideReason}`
      : 'Groupon request approved and confirmed.',
    payload: {
      previousStatus: booking.status,
      newStatus: 'confirmed',
      overrideReason: overrideReason || null,
      conflicts: conflictCheck.conflicts,
    },
  });

  let confirmationSent = false;
  let confirmationAlreadySent = false;
  if (typeof deps?.sendConfirmation === 'function' && customer?.email) {
    const sendResult = await deps.sendConfirmation({
      bookingId: booking.id,
      email: customer.email,
      source: 'groupon_approval',
    });
    confirmationSent = Boolean(sendResult?.ok);
    confirmationAlreadySent = Boolean(sendResult?.alreadySent);
  }

  return {
    ok: true,
    bookingId: booking.id,
    status: 'confirmed',
    confirmationSent,
    confirmationAlreadySent,
    conflicts: conflictCheck.conflicts,
  };
}

async function rejectGrouponBooking(
  supabase,
  { bookingId, adminUserId, reasonCode, reasonText, notifyCustomer = true },
  deps = {}
) {
  const ctx = await loadGrouponBookingContext(supabase, bookingId);
  const { booking, customer, voucher } = ctx;

  if (String(booking.booking_source || '') !== 'groupon') {
    const err = new Error('This is not a Groupon booking.');
    err.statusCode = 400;
    throw err;
  }
  if (String(booking.status || '') === 'cancelled') {
    return { ok: true, alreadyRejected: true, bookingId };
  }

  const code = String(reasonCode || 'other').trim();
  if (!REJECT_REASONS.has(code)) {
    const err = new Error('Invalid rejection reason.');
    err.statusCode = 400;
    throw err;
  }
  const reason = String(reasonText || '').trim();
  if (!reason) {
    const err = new Error('Rejection reason is required.');
    err.statusCode = 400;
    throw err;
  }

  const voucherId = booking.groupon_voucher_id || voucher?.id;
  if (voucherId && voucher?.local_status === 'reserved' && String(voucher.booking_id || '') === String(booking.id)) {
    await releaseVoucherPendingBooking(supabase, {
      voucherId,
      bookingId: booking.id,
      actorType: 'admin',
      actorId: adminUserId,
      reason: `Groupon request rejected: ${reason}`,
    });
  }

  const noteLine = `[Groupon rejected ${new Date().toISOString()}] ${code}: ${reason}`;
  const adminNotes = [booking.admin_notes, noteLine].filter(Boolean).join('\n');
  const { error: updateError } = await supabase
    .from('bookings')
    .update({ status: 'cancelled', admin_notes: adminNotes })
    .eq('id', booking.id);
  if (updateError) {
    const err = new Error(updateError.message || 'Could not reject booking.');
    err.statusCode = 500;
    throw err;
  }

  await bookingReliability.insertActivity(supabase, {
    booking_id: booking.id,
    event_type: 'groupon_request_rejected',
    actor_type: 'admin',
    actor_id: adminUserId,
    message: reason,
    payload: { reasonCode: code, previousStatus: booking.status },
  });

  if (notifyCustomer && deps.resend && deps.resendFrom && customer?.email) {
    try {
      const detail = { booking: { ...booking, customers: customer, status: 'cancelled' } };
      const preview = bookingCommunications.templateFor('groupon_request_rejected', detail);
      await bookingCommunications.sendEmail({
        supabase,
        resend: deps.resend,
        resendFrom: deps.resendFrom,
        bookingId: booking.id,
        adminUserId,
        preview,
      });
      const phone = preview.recipients.phone || preview.recipients.rawPhone;
      if (phone && bookingCommunications.smsConfigured()) {
        await bookingCommunications.sendSms({
          supabase,
          bookingId: booking.id,
          adminUserId,
          preview,
        });
      }
    } catch (notifyErr) {
      console.warn('[groupon-approval] reject notify failed:', notifyErr?.message || notifyErr);
    }
  }

  return { ok: true, bookingId: booking.id, status: 'cancelled' };
}

async function proposeGrouponAlternativeTime(
  supabase,
  deps,
  {
    bookingId,
    adminUserId,
    startTime,
    endTime,
    boatId = null,
    captainId = null,
    customerMessage = '',
    responseDeadline = null,
  }
) {
  const ctx = await loadGrouponBookingContext(supabase, bookingId);
  const { booking, customer } = ctx;

  if (!isGrouponPendingBooking(booking)) {
    const err = new Error('This booking is not a pending Groupon request.');
    err.statusCode = 400;
    throw err;
  }

  const nextStart = new Date(String(startTime || ''));
  const nextEnd = new Date(String(endTime || ''));
  if (!Number.isFinite(nextStart.getTime()) || !Number.isFinite(nextEnd.getTime()) || nextEnd <= nextStart) {
    const err = new Error('Choose a valid proposed date and time range.');
    err.statusCode = 400;
    throw err;
  }

  const update = {
    start_time: nextStart.toISOString(),
    end_time: nextEnd.toISOString(),
    duration_hours: Math.round(((nextEnd.getTime() - nextStart.getTime()) / 3600000) * 100) / 100,
    status: 'pending',
  };
  if (boatId) update.boat_id = boatId;
  if (captainId) update.captain_id = captainId;

  const draftBooking = { ...booking, ...update };
  const conflictCheck = await checkGrouponApprovalConflicts(supabase, draftBooking, {
    excludeBookingId: booking.id,
  });
  if (!conflictCheck.ok) {
    const err = new Error(conflictCheck.conflicts.map((c) => c.message).join(' '));
    err.statusCode = 409;
    err.conflicts = conflictCheck.conflicts;
    err.alternatives = conflictCheck.alternatives;
    throw err;
  }

  const proposalNote = [
    `[Groupon proposed time ${new Date().toISOString()}]`,
    `Original: ${booking.start_time}`,
    `Proposed: ${update.start_time}`,
    customerMessage ? `Message: ${customerMessage}` : null,
    responseDeadline ? `Respond by: ${responseDeadline}` : null,
  ]
    .filter(Boolean)
    .join('\n');
  update.admin_notes = [booking.admin_notes, proposalNote].filter(Boolean).join('\n');

  const { error } = await supabase.from('bookings').update(update).eq('id', booking.id);
  if (error) {
    const err = new Error(error.message || 'Could not save proposed time.');
    err.statusCode = 500;
    throw err;
  }

  await bookingReliability.insertActivity(supabase, {
    booking_id: booking.id,
    event_type: 'groupon_alternative_proposed',
    actor_type: 'admin',
    actor_id: adminUserId,
    message: customerMessage || 'Admin proposed an alternate departure time.',
    payload: {
      previousStart: booking.start_time,
      proposedStart: update.start_time,
      proposedEnd: update.end_time,
      responseDeadline: responseDeadline || null,
    },
  });

  if (deps.resend && deps.resendFrom && customer?.email) {
    try {
      const detail = {
        booking: {
          ...booking,
          ...update,
          customers: customer,
        },
      };
      const preview = bookingCommunications.templateFor('groupon_alternative_proposed', detail);
      if (customerMessage) {
        preview.emailBody = `${preview.emailBody}\n\nMessage from Launch Zone:\n${customerMessage}`;
        preview.smsBody = `${preview.smsBody} ${customerMessage}`.slice(0, 320);
      }
      await bookingCommunications.sendEmail({
        supabase,
        resend: deps.resend,
        resendFrom: deps.resendFrom,
        bookingId: booking.id,
        adminUserId,
        preview,
      });
      const phone = preview.recipients.phone || preview.recipients.rawPhone;
      if (phone && bookingCommunications.smsConfigured()) {
        await bookingCommunications.sendSms({
          supabase,
          bookingId: booking.id,
          adminUserId,
          preview,
        });
      }
    } catch (notifyErr) {
      console.warn('[groupon-approval] propose notify failed:', notifyErr?.message || notifyErr);
    }
  }

  return { ok: true, bookingId: booking.id, status: 'pending', startTime: update.start_time, endTime: update.end_time };
}

async function recordGrouponProposalResponse(
  supabase,
  deps,
  { bookingId, adminUserId, response, note = null }
) {
  const accepted = String(response || '').trim().toLowerCase() === 'accepted';
  const declined = String(response || '').trim().toLowerCase() === 'declined';
  if (!accepted && !declined) {
    const err = new Error('Response must be accepted or declined.');
    err.statusCode = 400;
    throw err;
  }

  const ctx = await loadGrouponBookingContext(supabase, bookingId);
  const { booking } = ctx;

  if (String(booking.booking_source || '') !== 'groupon') {
    const err = new Error('This is not a Groupon booking.');
    err.statusCode = 400;
    throw err;
  }

  if (accepted) {
    return approveGrouponBooking(supabase, deps, {
      bookingId,
      adminUserId,
      overrideReason: note || 'Customer accepted proposed alternate time.',
    });
  }

  const { error } = await supabase
    .from('bookings')
    .update({ status: 'pending_verification' })
    .eq('id', booking.id);
  if (error) throw error;

  await bookingReliability.insertActivity(supabase, {
    booking_id: booking.id,
    event_type: 'groupon_proposal_declined',
    actor_type: 'admin',
    actor_id: adminUserId,
    message: note || 'Customer declined proposed alternate time.',
    payload: { response: 'declined' },
  });

  return { ok: true, bookingId: booking.id, status: 'pending_verification', needsAttention: true };
}

async function listRecentGrouponRequests(supabase, { limit = 20, filter = 'pending_review' } = {}) {
  let query = supabase
    .from('bookings')
    .select(
      'id, status, start_time, end_time, guest_count, created_at, booking_source, customers(full_name, email, phone), boats(name), groupon_vouchers(voucher_last_four, deal_name, option_name, local_status)'
    )
    .eq('booking_source', 'groupon')
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(1, limit), 50));

  if (filter === 'pending_review') {
    query = query.in('status', ['pending_verification', 'pending']);
  } else if (filter === 'new_today') {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    query = query.gte('created_at', start.toISOString());
  } else if (filter === 'approved') {
    query = query.in('status', ['confirmed', 'ready_for_departure', 'completed']);
  } else if (filter === 'rejected') {
    query = query.eq('status', 'cancelled');
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map((row) => {
    const customer = Array.isArray(row.customers) ? row.customers[0] : row.customers;
    const voucher = Array.isArray(row.groupon_vouchers) ? row.groupon_vouchers[0] : row.groupon_vouchers;
    return {
      id: row.id,
      status: row.status,
      startTime: row.start_time,
      endTime: row.end_time,
      guestCount: row.guest_count,
      createdAt: row.created_at,
      customerName: customer?.full_name || 'Customer',
      email: customer?.email || null,
      phone: customer?.phone || null,
      boatName: (Array.isArray(row.boats) ? row.boats[0]?.name : row.boats?.name) || null,
      voucherMasked: voucher?.voucher_last_four ? `****${voucher.voucher_last_four}` : null,
      dealName: voucher?.deal_name || null,
    };
  });
}

module.exports = {
  APPROVABLE_STATUSES,
  REJECT_REASONS,
  isGrouponPendingBooking,
  loadGrouponBookingContext,
  checkGrouponApprovalConflicts,
  approveGrouponBooking,
  rejectGrouponBooking,
  proposeGrouponAlternativeTime,
  recordGrouponProposalResponse,
  listRecentGrouponRequests,
};
