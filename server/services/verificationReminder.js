/**
 * Incomplete-verification reminder (Resend). At most one send per booking (DB flag).
 * Future: delayed job can call maybeSendVerificationReminder with the same guards.
 */

const bookingCommunications = require('./bookingCommunications');

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function publicAppBase() {
  return (process.env.APP_PUBLIC_URL || process.env.FRONTEND_URL || '')
    .trim()
    .replace(/\/$/, '');
}

function bookingRequirementsComplete(booking) {
  const waiverOk = Boolean(booking.waiver_signed);
  const licenseOk = String(booking.license_status || '').trim().toLowerCase() === 'verified';
  const insuranceOk =
    Boolean(booking.captain_included) ||
    String(booking.insurance_status || '').trim().toLowerCase() === 'verified';
  return waiverOk && licenseOk && insuranceOk;
}

function missingRequirementLabels(booking) {
  const missing = [];
  if (!booking.waiver_signed) missing.push('waiver');
  if (String(booking.booking_type || '') === 'rental' && !booking.captain_included) {
    if (String(booking.license_status || '').trim().toLowerCase() !== 'verified') {
      missing.push("driver's license / ID");
    }
    const insuranceOk = ['verified', 'submitted'].includes(
      String(booking.insurance_status || '').trim().toLowerCase()
    );
    if (!insuranceOk) missing.push('Buoy rental insurance');
  }
  return missing;
}

/**
 * @param {object} opts
 * @param {import('@supabase/supabase-js').SupabaseClient} opts.supabaseAdmin
 * @param {import('resend').Resend | null} opts.resend
 * @param {string} opts.resendFrom
 * @param {string} opts.bookingId
 * @param {string} opts.email - must match customers.email for booking.customer_id
 * @returns {Promise<{ sent: boolean; reason?: string }>}
 */
async function maybeSendVerificationReminder(opts) {
  const { supabaseAdmin, resend, resendFrom, bookingId, email } = opts;

  if (!supabaseAdmin) {
    console.warn('[verification-reminder] skipped: no supabase admin client');
    return { sent: false, reason: 'no_db' };
  }
  if (!resend || !resendFrom) {
    console.warn('[verification-reminder] skipped: Resend not configured');
    return { sent: false, reason: 'no_resend' };
  }

  const emailNorm = String(email).trim().toLowerCase();
  const id = String(bookingId).trim();

  const { data: booking, error: fetchErr } = await supabaseAdmin
    .from('bookings')
    .select(
      'id, status, verification_reminder_sent_at, customer_id, booking_type, captain_included, waiver_signed, license_status, insurance_status, payment_status'
    )
    .eq('id', id)
    .maybeSingle();

  if (fetchErr) {
    console.error('[verification-reminder] fetch booking:', fetchErr);
    return { sent: false, reason: 'fetch_error' };
  }
  if (!booking) {
    return { sent: false, reason: 'no_booking' };
  }

  const { data: customer, error: custErr } = await supabaseAdmin
    .from('customers')
    .select('email')
    .eq('id', booking.customer_id)
    .maybeSingle();

  if (custErr || !customer || !customer.email) {
    console.error('[verification-reminder] fetch customer:', custErr);
    return { sent: false, reason: 'no_customer' };
  }

  if (customer.email.trim().toLowerCase() !== emailNorm) {
    console.warn('[verification-reminder] email mismatch for booking', id);
    return { sent: false, reason: 'email_mismatch' };
  }

  const paymentStatus = String(booking.payment_status || '').trim().toLowerCase();
  if (!['paid', 'deposit_paid'].includes(paymentStatus)) {
    return { sent: false, reason: 'unpaid' };
  }

  if (booking.status !== 'pending_verification') {
    return { sent: false, reason: 'not_pending_verification' };
  }
  if (booking.verification_reminder_sent_at) {
    return { sent: false, reason: 'already_sent' };
  }

  if (bookingRequirementsComplete(booking)) {
    return { sent: false, reason: 'requirements_complete' };
  }

  const missing = missingRequirementLabels(booking);
  if (missing.length === 0) {
    return { sent: false, reason: 'nothing_missing' };
  }

  const base = publicAppBase();
  if (!base) {
    console.warn('[verification-reminder] skipped: APP_PUBLIC_URL/FRONTEND_URL not configured');
    return { sent: false, reason: 'no_public_base' };
  }
  const verifyUrl = `${base}/waivers-insurance?bookingId=${encodeURIComponent(id)}`;
  const missingText = missing.join(', ');
  const subject = 'Complete your pre-trip requirements — Launch Zone Charters';

  const textBody = `Your Launch Zone Charters reservation is paid and saved.

Please complete before your trip: ${missingText}.

Finish here:
${verifyUrl}`;

  const htmlBody = `
    <p>Your Launch Zone Charters reservation is <strong>paid and saved</strong>.</p>
    <p>Please complete before your trip: <strong>${escapeHtml(missingText)}</strong>.</p>
    <p><a href="${escapeHtml(verifyUrl)}">Open Waivers &amp; Insurance</a></p>
    <p>If you have questions, call <a href="tel:803-542-1761">803-542-1761</a>.</p>
  `;

  try {
    const result = await resend.emails.send({
      from: resendFrom,
      to: emailNorm,
      subject,
      text: textBody,
      html: htmlBody,
    });
    if (result.error) {
      console.error('[verification-reminder] Resend error:', result.error);
      return { sent: false, reason: 'resend_error' };
    }

    await bookingCommunications.logAutomatedCommunication(supabaseAdmin, {
      bookingId: id,
      channel: 'email',
      messageType: 'automated_verification_reminder',
      recipient: emailNorm,
      subject,
      body: textBody,
      providerMessageId: result.data?.id || null,
    });

    const stamp = { verification_reminder_sent_at: new Date().toISOString() };
    const markSent = () =>
      supabaseAdmin
        .from('bookings')
        .update(stamp)
        .eq('id', id)
        .eq('status', 'pending_verification')
        .is('verification_reminder_sent_at', null)
        .select('id')
        .maybeSingle();

    let { data: updated, error: updErr } = await markSent();
    if (updErr) {
      await new Promise((r) => setTimeout(r, 150));
      ({ data: updated, error: updErr } = await markSent());
    }

    if (updErr) {
      console.error('[verification-reminder] failed to set sent_at (may resend on retry):', updErr);
    } else if (!updated) {
      console.warn('[verification-reminder] email sent but sent_at race lost; id=', id);
    }

    return { sent: true };
  } catch (err) {
    console.error('[verification-reminder] unexpected:', err);
    return { sent: false, reason: 'exception' };
  }
}

module.exports = {
  bookingRequirementsComplete,
  maybeSendVerificationReminder,
  missingRequirementLabels,
  publicAppBase,
};
