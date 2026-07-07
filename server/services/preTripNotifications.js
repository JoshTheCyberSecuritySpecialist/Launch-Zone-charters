/**
 * Waivers & Insurance notifications (Resend + optional Twilio).
 */

const { sendSMS } = require('./sms');
const { publicAppBase } = require('./verificationReminder');
const bookingCommunications = require('./bookingCommunications');

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function waiversInsuranceUrl(opts = {}) {
  const base = publicAppBase();
  if (!base) return '';
  const params = new URLSearchParams();
  if (opts.bookingId) params.set('bookingId', String(opts.bookingId).trim());
  if (opts.submissionId) params.set('submissionId', String(opts.submissionId).trim());
  const q = params.toString();
  return q ? `${base}/waivers-insurance?${q}` : `${base}/waivers-insurance`;
}

function tripTypeLabel(tripType) {
  switch (tripType) {
    case 'pontoon_rental':
      return 'Pontoon Rental';
    case 'center_console_rental':
      return 'Center Console Rental';
    case 'captain_charter':
      return 'Captain-Led Charter';
    default:
      return String(tripType || 'Trip');
  }
}

/**
 * @param {import('resend').Resend | null} resend
 * @param {string} resendFrom
 * @param {object} submission - pre_trip_submissions row
 */
async function sendPreTripCustomerConfirmation(resend, resendFrom, submission) {
  if (!resend || !resendFrom) return { sent: false, reason: 'no_resend' };
  const email = String(submission.email || '').trim().toLowerCase();
  if (!email) return { sent: false, reason: 'no_email' };

  const statusUrl = waiversInsuranceUrl({ submissionId: submission.id });
  const name = String(submission.customer_name || '').trim() || 'there';
  const subject = 'We received your pre-trip documents — Launch Zone Charters';

  const textBody = `Hi ${name},

Thanks for submitting your pre-trip documents. Our team will review them and match them to your reservation.

Track your status:
${statusUrl}

Reference: ${submission.id}

Questions? Call 803-542-1761.
— Launch Zone Charters`;

  const htmlBody = `
    <p>Hi ${escapeHtml(name)},</p>
    <p>Thanks for submitting your pre-trip documents. Our team will review them and match them to your reservation.</p>
    <p><a href="${escapeHtml(statusUrl)}">View your pre-trip status</a></p>
    <p><small>Reference: ${escapeHtml(submission.id)}</small></p>
    <p>Questions? Call <a href="tel:803-542-1761">803-542-1761</a>.</p>
    <p>— Launch Zone Charters</p>
  `;

  const result = await resend.emails.send({
    from: resendFrom,
    to: email,
    subject,
    text: textBody,
    html: htmlBody,
  });
  if (result.error) {
    console.error('[pre-trip-notify] customer email:', result.error);
    return { sent: false, reason: 'resend_error' };
  }
  return { sent: true };
}

/**
 * @param {import('resend').Resend | null} resend
 * @param {string} resendFrom
 * @param {string} adminEmail
 * @param {string} businessName
 * @param {object} submission
 */
async function sendPreTripAdminAlert(resend, resendFrom, adminEmail, businessName, submission) {
  if (!resend || !resendFrom || !adminEmail) return { sent: false, reason: 'no_config' };

  const adminUrl = publicAppBase() ? `${publicAppBase()}/admin` : '';
  const subject = `New pre-trip submission — ${businessName || 'Launch Zone Charters'}`;
  const grouponLine = submission.groupon_code
    ? `\nGroupon code: ${submission.groupon_code}`
    : '';

  const textBody = `New off-platform pre-trip submission:

Customer: ${submission.customer_name || '—'}
Email: ${submission.email}
Phone: ${submission.phone || '—'}
Trip: ${tripTypeLabel(submission.trip_type)}${grouponLine}
Submission ID: ${submission.id}

Review in admin: ${adminUrl || '(set APP_PUBLIC_URL)'}`;

  const htmlBody = `
    <p><strong>New pre-trip submission</strong></p>
    <ul>
      <li>Customer: ${escapeHtml(submission.customer_name || '—')}</li>
      <li>Email: ${escapeHtml(submission.email)}</li>
      <li>Phone: ${escapeHtml(submission.phone || '—')}</li>
      <li>Trip: ${escapeHtml(tripTypeLabel(submission.trip_type))}</li>
      ${
        submission.groupon_code
          ? `<li>Groupon: <strong>${escapeHtml(submission.groupon_code)}</strong></li>`
          : ''
      }
      <li>ID: <code>${escapeHtml(submission.id)}</code></li>
    </ul>
    ${adminUrl ? `<p><a href="${escapeHtml(adminUrl)}">Open admin dashboard</a></p>` : ''}
  `;

  const result = await resend.emails.send({
    from: resendFrom,
    to: adminEmail,
    subject,
    text: textBody,
    html: htmlBody,
  });
  if (result.error) {
    console.error('[pre-trip-notify] admin email:', result.error);
    return { sent: false, reason: 'resend_error' };
  }
  return { sent: true };
}

async function maybeSendPreTripCustomerSms(submission) {
  const phone = String(submission.phone || '').trim();
  if (!phone) return { sent: false, reason: 'no_phone' };
  const statusUrl = waiversInsuranceUrl({ submissionId: submission.id });
  const message = `Launch Zone Charters: We received your pre-trip documents. Track status: ${statusUrl}`;
  const result = await sendSMS(phone, message);
  return result.ok ? { sent: true } : { sent: false, reason: result.skipped ? 'sms_skipped' : 'sms_failed' };
}

function bookingNeedsRentalDocs(booking) {
  if (booking.captain_included) return false;
  return true;
}

function bookingDocsComplete(booking, customer) {
  if (!booking.waiver_signed) return false;
  if (!bookingNeedsRentalDocs(booking)) return true;
  const hasLicense = Boolean(
    String(booking.license_url || customer?.id_document_url || '').trim()
  );
  const insuranceOk =
    booking.insurance_status === 'verified' ||
    booking.insurance_status === 'submitted' ||
    Boolean(String(booking.insurance_url || customer?.insurance_proof_url || '').trim());
  return hasLicense && insuranceOk;
}

/**
 * Customer confirmation after all waivers/docs submitted on an existing booking.
 */
async function maybeSendBookingWaiversConfirmation(opts) {
  const { supabase, resend, resendFrom, bookingId } = opts;
  if (!supabase || !resend || !resendFrom) return { sent: false, reason: 'no_config' };

  const id = String(bookingId).trim();
  const { data: booking, error: bErr } = await supabase
    .from('bookings')
    .select(
      'id, customer_id, waiver_signed, license_url, insurance_url, license_status, insurance_status, captain_included, status, waivers_docs_confirmation_sent_at'
    )
    .eq('id', id)
    .maybeSingle();

  if (bErr || !booking) return { sent: false, reason: 'no_booking' };
  if (booking.waivers_docs_confirmation_sent_at) return { sent: false, reason: 'already_sent' };
  if (['cancelled', 'completed'].includes(String(booking.status || ''))) {
    return { sent: false, reason: 'inactive' };
  }

  const { data: customer, error: cErr } = await supabase
    .from('customers')
    .select('email, phone, full_name, id_document_url, insurance_proof_url')
    .eq('id', booking.customer_id)
    .maybeSingle();

  if (cErr || !customer?.email) return { sent: false, reason: 'no_customer' };
  if (!bookingDocsComplete(booking, customer)) return { sent: false, reason: 'incomplete' };

  const statusUrl = waiversInsuranceUrl({ bookingId: id });
  const name = String(customer.full_name || '').trim() || 'there';
  const subject = 'Pre-trip documents received — Launch Zone Charters';

  const textBody = `Hi ${name},

We received your waiver and documents. Our team will review them before your trip.

Track your status:
${statusUrl}

You are not cleared for departure until we mark you Ready for Departure.

— Launch Zone Charters`;

  const htmlBody = `
    <p>Hi ${escapeHtml(name)},</p>
    <p>We received your waiver and documents. Our team will review them before your trip.</p>
    <p><a href="${escapeHtml(statusUrl)}">View your pre-trip status</a></p>
    <p><small>You are not cleared for departure until Launch Zone Charters marks you <strong>Ready for Departure</strong>.</small></p>
    <p>— Launch Zone Charters</p>
  `;

  const email = customer.email.trim().toLowerCase();
  const result = await resend.emails.send({
    from: resendFrom,
    to: email,
    subject,
    text: textBody,
    html: htmlBody,
  });
  if (result.error) {
    console.error('[pre-trip-notify] booking confirmation:', result.error);
    return { sent: false, reason: 'resend_error' };
  }

  await bookingCommunications.logAutomatedCommunication(supabase, {
    bookingId: id,
    channel: 'email',
    messageType: 'automated_pre_trip_confirmation',
    recipient: email,
    subject,
    body: textBody,
    providerMessageId: result.data?.id || null,
  });

  const stamp = { waivers_docs_confirmation_sent_at: new Date().toISOString() };
  await supabase.from('bookings').update(stamp).eq('id', id).is('waivers_docs_confirmation_sent_at', null);

  const phone = String(customer.phone || '').trim();
  if (phone) {
    await sendSMS(
      phone,
      `Launch Zone Charters: We received your pre-trip documents. Track status: ${statusUrl}`
    ).catch(() => {});
  }

  return { sent: true };
}

/**
 * Fire-and-forget after pre_trip_submissions insert.
 */
async function onPreTripSubmissionCreated(opts) {
  const { supabase, resend, resendFrom, adminEmail, businessName, submission } = opts;
  if (!submission?.id) return;

  try {
    const cust = await sendPreTripCustomerConfirmation(resend, resendFrom, submission);
    if (cust.sent) {
      await supabase
        .from('pre_trip_submissions')
        .update({ customer_notified_at: new Date().toISOString() })
        .eq('id', submission.id)
        .is('customer_notified_at', null);
      await maybeSendPreTripCustomerSms(submission);
    }

    const admin = await sendPreTripAdminAlert(
      resend,
      resendFrom,
      adminEmail,
      businessName,
      submission
    );
    if (admin.sent) {
      await supabase
        .from('pre_trip_submissions')
        .update({ admin_notified_at: new Date().toISOString() })
        .eq('id', submission.id)
        .is('admin_notified_at', null);
    }
  } catch (err) {
    console.error('[pre-trip-notify] onPreTripSubmissionCreated:', err);
  }
}

module.exports = {
  waiversInsuranceUrl,
  sendPreTripCustomerConfirmation,
  sendPreTripAdminAlert,
  maybeSendBookingWaiversConfirmation,
  onPreTripSubmissionCreated,
  bookingDocsComplete,
  bookingNeedsRentalDocs,
};
