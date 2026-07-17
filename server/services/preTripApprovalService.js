const waiverContent = require('../content/waiverContent');

const REVIEWABLE_STATUSES = ['pending', 'matched'];

function logOpFailure(table, operation, err) {
  const code = err?.code ? String(err.code) : 'unknown';
  const message = err?.message ? String(err.message) : 'unknown error';
  console.error(`[pre-trip-approval] table=${table} operation=${operation} code=${code} message=${message}`);
}

function buildBookingUpdatesFromSubmission(submission, booking, options = {}) {
  const verifyLicense = Boolean(options.verifyLicense);
  const updates = {};

  if (submission.license_url) {
    if (!booking.license_url) {
      updates.license_url = submission.license_url;
    }
    if (verifyLicense) {
      updates.license_status = 'verified';
    } else if (!booking.license_url) {
      updates.license_status = 'pending';
    }
  }

  if (submission.insurance_url) {
    updates.insurance_url = submission.insurance_url;
    updates.insurance_status =
      submission.insurance_status === 'submitted' ? 'submitted' : 'pending';
  }

  if (submission.waiver_signed && !booking.waiver_signed) {
    updates.waiver_signed = true;
    updates.waiver_signed_at = submission.waiver_signed_at || new Date().toISOString();
    updates.terms_accepted = true;
    updates.damage_fee_acknowledged = true;
  }

  return updates;
}

async function loadBookingForPreTripSync(supabase, bookingId) {
  const { data, error } = await supabase
    .from('bookings')
    .select('id, customer_id, waiver_signed, license_url, insurance_url, license_status, insurance_status')
    .eq('id', bookingId)
    .maybeSingle();

  if (error) {
    logOpFailure('bookings', 'select', error);
    const err = new Error('Could not load booking for pre-trip sync');
    err.statusCode = 500;
    throw err;
  }
  if (!data) {
    const err = new Error('Booking not found');
    err.statusCode = 404;
    throw err;
  }
  return data;
}

async function applySubmissionToBooking(supabase, submission, bookingId, requestIp, options = {}) {
  const booking = await loadBookingForPreTripSync(supabase, bookingId);
  const bookingUpdates = buildBookingUpdatesFromSubmission(submission, booking, options);

  if (Object.keys(bookingUpdates).length > 0) {
    const { error: uErr } = await supabase.from('bookings').update(bookingUpdates).eq('id', bookingId);
    if (uErr) {
      logOpFailure('bookings', 'update', uErr);
      const err = new Error(uErr.message || 'Could not update booking');
      err.statusCode = 500;
      throw err;
    }
  }

  if (submission.license_url) {
    const { error } = await supabase
      .from('customers')
      .update({ id_document_url: submission.license_url })
      .eq('id', booking.customer_id);
    if (error) logOpFailure('customers', 'update_id_document', error);
  }

  if (submission.insurance_url) {
    const { error } = await supabase
      .from('customers')
      .update({ insurance_proof_url: submission.insurance_url })
      .eq('id', booking.customer_id);
    if (error) logOpFailure('customers', 'update_insurance_proof', error);
  }

  if (submission.waiver_signed && submission.waiver_signature) {
    const { data: existingWaiver, error: wSelErr } = await supabase
      .from('waivers')
      .select('id')
      .eq('booking_id', bookingId)
      .limit(1)
      .maybeSingle();
    if (wSelErr) {
      logOpFailure('waivers', 'select', wSelErr);
    } else if (!existingWaiver) {
      const waiverFields = waiverContent.waiverInsertFields('rental');
      const { error: wInsErr } = await supabase.from('waivers').insert({
        booking_id: bookingId,
        customer_id: booking.customer_id,
        electronic_signature: submission.waiver_signature,
        signature_date: submission.waiver_signed_at || new Date().toISOString(),
        ip_address: requestIp,
        accepted: true,
        ...waiverFields,
      });
      if (wInsErr) logOpFailure('waivers', 'insert', wInsErr);
    }
  }

  if (submission.insurance_url) {
    const { error } = await supabase.from('user_verifications').upsert(
      {
        booking_id: bookingId,
        buoy_status: 'pending',
        buoy_proof_url: submission.insurance_url,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'booking_id' }
    );
    if (error) logOpFailure('user_verifications', 'upsert', error);
  }

  return booking;
}

async function updateSubmissionWithLock(supabase, submissionId, updates) {
  const { data, error } = await supabase
    .from('pre_trip_submissions')
    .update(updates)
    .eq('id', submissionId)
    .in('admin_status', REVIEWABLE_STATUSES)
    .select('id, admin_status, matched_booking_id, reviewed_at, rejection_reason')
    .maybeSingle();

  if (error) {
    logOpFailure('pre_trip_submissions', 'update', error);
    const err = new Error(error.message || 'Could not update submission');
    err.statusCode = 500;
    throw err;
  }
  if (!data) {
    const err = new Error('Submission was already processed or is no longer reviewable.');
    err.statusCode = 409;
    throw err;
  }
  return data;
}

async function rejectPreTripSubmission(supabase, { submissionId, submission, adminUserId, adminNotes, rejectionReason, stamp }) {
  const updates = {
    updated_at: stamp,
    admin_status: 'rejected',
    rejection_reason: rejectionReason,
    reviewed_by: adminUserId || null,
    reviewed_at: stamp,
  };
  if (adminNotes !== null) updates.admin_notes = adminNotes;

  const row = await updateSubmissionWithLock(supabase, submissionId, updates);
  return {
    ok: true,
    admin_status: row.admin_status,
    reviewed_at: row.reviewed_at,
    rejection_reason: row.rejection_reason,
    matched_booking_id: submission.matched_booking_id || null,
  };
}

async function approveOrMatchPreTripSubmission(
  supabase,
  { submissionId, submission, action, bookingId, adminUserId, adminNotes, requestIp, stamp }
) {
  await applySubmissionToBooking(supabase, submission, bookingId, requestIp, {
    verifyLicense: action === 'approve',
  });

  const updates = {
    updated_at: stamp,
    matched_booking_id: bookingId,
    admin_status: action === 'approve' ? 'approved' : 'matched',
  };
  if (adminNotes !== null) updates.admin_notes = adminNotes;
  if (action === 'approve') {
    updates.reviewed_by = adminUserId || null;
    updates.reviewed_at = stamp;
    if (submission.license_url) {
      updates.license_status = 'verified';
    }
  }

  const row = await updateSubmissionWithLock(supabase, submissionId, updates);
  return {
    ok: true,
    admin_status: row.admin_status,
    matched_booking_id: row.matched_booking_id || bookingId,
    reviewed_at: row.reviewed_at || null,
  };
}

module.exports = {
  REVIEWABLE_STATUSES,
  buildBookingUpdatesFromSubmission,
  applySubmissionToBooking,
  updateSubmissionWithLock,
  rejectPreTripSubmission,
  approveOrMatchPreTripSubmission,
};
