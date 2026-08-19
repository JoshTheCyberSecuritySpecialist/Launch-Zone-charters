/**
 * Rocket launch two-step customer emails:
 * 1) Reservation received (shared, below minimum) — not "trip confirmed"
 * 2) Departure confirmed (private immediately, shared when minimum reached)
 */
const {
  ROCKET_LAUNCH_MIN_GUESTS,
  isRocketLaunchPackageId,
} = require('../config/rocketLaunchPackages');
const {
  DEPARTURE_STATUS,
  normalizeRocketCharterType,
} = require('./rocketDepartureService');
const bookingCommunications = require('./bookingCommunications');

const MESSAGE_TYPE_RESERVATION = 'rocket_launch_reservation_received';
const MESSAGE_TYPE_DEPARTURE_CONFIRMED = 'rocket_launch_departure_confirmed';

const ROCKET_SCHEDULE_NOTICE =
  'Rocket launch dates and times may change due to weather, technical issues, or decisions made by the launch provider. Launch Zone Charters does not control the launch schedule. If a launch is delayed, scrubbed, or rescheduled, affected guests will be contacted regarding available options.';

const ROCKET_SHARED_MINIMUM_NOTICE =
  'Your seats are reserved on a shared rocket launch charter. This trip requires a minimum number of booked guests before the departure is fully confirmed. If the minimum is not reached, Launch Zone Charters will contact you regarding your available options.';

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isRocketPackageBooking(booking) {
  const pkg = String(booking?.pricing_package_id || '').trim();
  if (pkg && isRocketLaunchPackageId(pkg)) return true;
  return (
    Boolean(booking?.is_rocket_tour) &&
    normalizeRocketCharterType(booking?.charter_type) === 'rocket'
  );
}

function shouldSendRocketReservationEmail(booking) {
  return (
    isRocketPackageBooking(booking) &&
    String(booking?.charter_seating || '').trim().toLowerCase() === 'shared' &&
    String(booking?.departure_confirmation_status || '') === DEPARTURE_STATUS.AWAITING_MINIMUM
  );
}

function shouldSendRocketDepartureConfirmedEmail(booking) {
  if (!isRocketPackageBooking(booking)) return false;
  const seating = String(booking?.charter_seating || '').trim().toLowerCase();
  const status = String(booking?.departure_confirmation_status || '').trim();
  if (seating === 'private') return true;
  return (
    status === DEPARTURE_STATUS.DEPARTURE_CONFIRMED ||
    status === DEPARTURE_STATUS.DEPARTURE_FULL
  );
}

function buildRocketReservationContent({ booking, customer, boat, source, confirmationHelpers }) {
  const {
    formatDateLabel,
    formatTimeRange,
    experienceLabel,
    paymentSummary,
    SUPPORT_PHONE,
    SUPPORT_PHONE_TEL,
  } = confirmationHelpers;

  const name = customer?.full_name || 'there';
  const dateLabel = formatDateLabel(booking.start_time);
  const timeRange = formatTimeRange(booking.start_time, booking.end_time);
  const guests = Math.max(1, Number(booking.guest_count || booking.package_guest_count || 1));
  const experience = experienceLabel(booking);
  const boatName = boat?.name || null;
  const paymentLine = paymentSummary(booking);

  const subject = 'Rocket Launch Reservation Received';

  const textBody = [
    'Reservation Received — Awaiting Minimum Guest Count',
    '',
    `Hi ${name},`,
    '',
    'Thank you — your payment was received and your rocket launch seats are reserved.',
    '',
    ROCKET_SHARED_MINIMUM_NOTICE,
    '',
    `This shared charter needs at least ${ROCKET_LAUNCH_MIN_GUESTS} total booked guests before the departure is fully confirmed.`,
    'We will contact you once the minimum is reached or if we need to discuss options.',
    '',
    'Trip Details',
    `Date: ${dateLabel}`,
    `Time: ${timeRange}`,
    `Guests: ${guests}`,
    `Package: ${experience}`,
    boatName ? `Boat: ${boatName}` : null,
    `Booking #: ${booking.id}`,
    paymentLine,
    '',
    'Important',
    ROCKET_SCHEDULE_NOTICE,
    '',
    'This message confirms your reservation and payment — not that the shared charter departure is guaranteed to operate.',
    '',
    `Questions? Call ${SUPPORT_PHONE}.`,
    '',
    `Booking source: ${source}`,
  ]
    .filter(Boolean)
    .join('\n');

  const htmlBody = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
        <tr><td style="background:#78350f;color:#ffffff;padding:24px 28px;">
          <p style="margin:0 0 8px;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#fde68a;">Launch Zone Charters</p>
          <h1 style="margin:0;font-size:26px;line-height:1.2;">Reservation Received</h1>
          <p style="margin:10px 0 0;font-size:15px;line-height:1.5;color:#fef3c7;">Awaiting minimum guest count — not fully confirmed yet</p>
        </td></tr>
        <tr><td style="padding:28px;">
          <p style="margin:0 0 18px;font-size:16px;line-height:1.6;">Hi ${escapeHtml(name)}, thank you — your payment was received and your seats are reserved.</p>
          <div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:12px;padding:18px;margin-bottom:20px;">
            <p style="margin:0;font-size:15px;line-height:1.6;color:#92400e;">${escapeHtml(ROCKET_SHARED_MINIMUM_NOTICE)}</p>
            <p style="margin:12px 0 0;font-size:14px;line-height:1.6;color:#78350f;">Minimum ${ROCKET_LAUNCH_MIN_GUESTS} total guests required before this shared departure is fully confirmed.</p>
          </div>
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin-bottom:20px;">
            <p style="margin:0 0 12px;font-size:13px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#64748b;">Trip Details</p>
            <p style="margin:0 0 8px;font-size:24px;line-height:1.3;font-weight:700;color:#0f172a;">${escapeHtml(dateLabel)}</p>
            <p style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#0f766e;font-weight:700;">${escapeHtml(timeRange)}</p>
            <p style="margin:0 0 6px;font-size:15px;"><strong>Guests:</strong> ${escapeHtml(String(guests))}</p>
            <p style="margin:0 0 6px;font-size:15px;"><strong>Package:</strong> ${escapeHtml(experience)}</p>
            ${boatName ? `<p style="margin:0 0 6px;font-size:15px;"><strong>Boat:</strong> ${escapeHtml(boatName)}</p>` : ''}
            <p style="margin:0 0 6px;font-size:15px;"><strong>Booking #:</strong> ${escapeHtml(booking.id)}</p>
            <p style="margin:0;font-size:14px;line-height:1.5;color:#475569;">${escapeHtml(paymentLine)}</p>
          </div>
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:18px;margin-bottom:20px;">
            <p style="margin:0 0 8px;font-size:13px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#64748b;">Rocket Launch Schedule Notice</p>
            <p style="margin:0;font-size:14px;line-height:1.6;color:#334155;">${escapeHtml(ROCKET_SCHEDULE_NOTICE)}</p>
          </div>
          <p style="margin:0;font-size:15px;line-height:1.6;">Questions? Call <a href="${SUPPORT_PHONE_TEL}" style="color:#0f766e;font-weight:700;">${SUPPORT_PHONE}</a>.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, textBody, htmlBody };
}

function buildRocketDepartureConfirmedContent({
  booking,
  customer,
  boat,
  source,
  confirmationHelpers,
}) {
  const base = confirmationHelpers.buildConfirmationContent({
    booking,
    customer,
    boat,
    source,
  });

  const name = customer?.full_name || 'there';
  const dateLabel = confirmationHelpers.formatDateLabel(booking.start_time);
  const subject = `Your Rocket Launch Charter Is Confirmed${dateLabel && dateLabel !== '—' ? ` — ${dateLabel}` : ''}`;

  const introLines = [
    'Your Rocket Launch Charter Is Confirmed',
    '',
    `Hi ${name},`,
    '',
    'Great news — your rocket launch charter departure is fully confirmed.',
  ];
  if (String(booking.charter_seating || '').trim().toLowerCase() === 'shared') {
    introLines.push(
      '',
      `The shared charter reached the minimum of ${ROCKET_LAUNCH_MIN_GUESTS} booked guests for this departure.`
    );
  }
  introLines.push('', ROCKET_SCHEDULE_NOTICE, '');

  const textBody = [
    ...introLines,
    base.textBody.split('\n').slice(3).join('\n'),
  ].join('\n');

  const scheduleHtml = `<div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:12px;padding:18px;margin-bottom:20px;">
    <p style="margin:0 0 8px;font-size:13px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#92400e;">Rocket Launch Schedule Notice</p>
    <p style="margin:0;font-size:14px;line-height:1.6;color:#78350f;">${escapeHtml(ROCKET_SCHEDULE_NOTICE)}</p>
  </div>`;

  const htmlBody = base.htmlBody
    .replace(
      '<h1 style="margin:0;font-size:28px;line-height:1.2;">Booking Confirmed</h1>',
      '<h1 style="margin:0;font-size:28px;line-height:1.2;">Rocket Launch Charter Confirmed</h1>'
    )
    .replace(
      'your reservation is confirmed.',
      'your rocket launch charter departure is fully confirmed.'
    )
    .replace(
      '</div>\n          <div style="background:#ecfeff;border:1px solid #99f6e4',
      `</div>\n          ${scheduleHtml}\n          <div style="background:#ecfeff;border:1px solid #99f6e4`
    );

  return {
    subject,
    textBody,
    htmlBody,
    meeting: base.meeting,
    mapsUrl: base.mapsUrl,
    docsUrl: base.docsUrl,
  };
}

async function sendRocketReservationEmail({
  supabase,
  resend,
  resendFrom,
  booking,
  customer,
  boat,
  bookingId,
  emailSafe,
  source,
  forceResend,
  confirmationHelpers,
  bookingReliability = null,
}) {
  if (!forceResend) {
    const prior = await bookingCommunications.recentSuccessfulCommunication(
      supabase,
      bookingId,
      MESSAGE_TYPE_RESERVATION,
      'email'
    );
    if (prior?.id) {
      return { ok: true, alreadySent: true, email: emailSafe, kind: 'reservation' };
    }
  }

  const content = buildRocketReservationContent({
    booking,
    customer,
    boat,
    source,
    confirmationHelpers,
  });

  const customerResult = await resend.emails.send({
    from: resendFrom,
    to: emailSafe,
    subject: content.subject,
    text: content.textBody,
    html: content.htmlBody,
  });
  if (customerResult.error) {
    const err = new Error(customerResult.error.message || 'Failed to send reservation email');
    err.statusCode = 500;
    throw err;
  }

  await bookingCommunications.logAutomatedCommunication(supabase, {
    bookingId,
    channel: 'email',
    messageType: MESSAGE_TYPE_RESERVATION,
    recipient: emailSafe,
    subject: content.subject,
    body: content.textBody,
    providerMessageId: customerResult.data?.id || null,
  });

  if (bookingReliability) {
    await bookingReliability.insertActivity(supabase, {
      booking_id: bookingId,
      event_type: 'emails_sent',
      message: 'Rocket launch reservation received email sent.',
      payload: { source, email: emailSafe, kind: 'reservation' },
    });
  }

  return { ok: true, alreadySent: false, email: emailSafe, subject: content.subject, kind: 'reservation' };
}

async function sendRocketDepartureConfirmedEmail({
  supabase,
  resend,
  resendFrom,
  booking,
  customer,
  boat,
  bookingId,
  emailSafe,
  source,
  forceResend,
  confirmationHelpers,
  bookingReliability = null,
  verificationReminder = null,
  verificationSms = null,
}) {
  if (!forceResend) {
    const prior = await bookingCommunications.recentSuccessfulCommunication(
      supabase,
      bookingId,
      MESSAGE_TYPE_DEPARTURE_CONFIRMED,
      'email'
    );
    if (prior?.id || booking.booking_confirmation_sent_at) {
      return { ok: true, alreadySent: true, email: emailSafe, kind: 'departure_confirmed' };
    }
  }

  const content = buildRocketDepartureConfirmedContent({
    booking,
    customer,
    boat,
    source,
    confirmationHelpers,
  });

  const customerResult = await resend.emails.send({
    from: resendFrom,
    to: emailSafe,
    subject: content.subject,
    text: content.textBody,
    html: content.htmlBody,
  });
  if (customerResult.error) {
    const err = new Error(customerResult.error.message || 'Failed to send departure confirmed email');
    err.statusCode = 500;
    throw err;
  }

  await bookingCommunications.logAutomatedCommunication(supabase, {
    bookingId,
    channel: 'email',
    messageType: MESSAGE_TYPE_DEPARTURE_CONFIRMED,
    recipient: emailSafe,
    subject: content.subject,
    body: content.textBody,
    providerMessageId: customerResult.data?.id || null,
  });

  if (!forceResend) {
    await supabase
      .from('bookings')
      .update({ booking_confirmation_sent_at: new Date().toISOString() })
      .eq('id', bookingId)
      .is('booking_confirmation_sent_at', null);
  }

  if (bookingReliability) {
    await bookingReliability.insertActivity(supabase, {
      booking_id: bookingId,
      event_type: 'emails_sent',
      message: 'Rocket launch departure confirmed email sent.',
      payload: { source, email: emailSafe, kind: 'departure_confirmed' },
    });
  }

  if (verificationReminder) {
    try {
      await verificationReminder.maybeSendVerificationReminder({
        supabaseAdmin: supabase,
        resend,
        resendFrom,
        bookingId,
        email: emailSafe,
      });
    } catch (remErr) {
      console.error('[rocket-launch-email] verification reminder:', remErr?.message || remErr);
    }
  }

  if (verificationSms) {
    try {
      await verificationSms.maybeSendVerificationSms({
        supabaseAdmin: supabase,
        bookingId,
        email: emailSafe,
        publicAppBase: confirmationHelpers.publicAppBase(),
      });
    } catch (_smsErr) {
      /* optional */
    }
  }

  return {
    ok: true,
    alreadySent: false,
    email: emailSafe,
    subject: content.subject,
    kind: 'departure_confirmed',
  };
}

async function maybeNotifyRocketDepartureGroupConfirmed({
  supabase,
  resend,
  resendFrom,
  sharedDepartureId,
  source = 'departure_minimum_reached',
  forceResend = false,
  confirmationHelpers,
  bookingReliability = null,
  verificationReminder = null,
  verificationSms = null,
}) {
  const id = String(sharedDepartureId || '').trim();
  if (!supabase || !id || !resend || !resendFrom) {
    return { notified: 0, skipped: true };
  }

  const { data: rows, error } = await supabase
    .from('bookings')
    .select(
      'id, customer_id, boat_id, start_time, end_time, status, payment_status, payment_method, booking_source, booking_type, charter_type, charter_seating, rental_location, guest_count, package_guest_count, pricing_package_name, pricing_package_id, is_rocket_tour, captain_included, waiver_signed, license_status, insurance_status, deposit_paid, deposit_amount, balance_due, total_price, final_total, final_amount_cents, booking_confirmation_sent_at, departure_confirmation_status, shared_departure_id, customers(id, full_name, email, phone), boats(id, name, type)'
    )
    .eq('shared_departure_id', id);
  if (error) throw error;

  const bookings = Array.isArray(rows) ? rows : [];
  if (bookings.length === 0) return { notified: 0 };

  const status = String(bookings[0]?.departure_confirmation_status || '');
  if (
    status !== DEPARTURE_STATUS.DEPARTURE_CONFIRMED &&
    status !== DEPARTURE_STATUS.DEPARTURE_FULL
  ) {
    return { notified: 0, skipped: true, reason: 'minimum_not_reached' };
  }

  let notified = 0;
  for (const row of bookings) {
    const customer = Array.isArray(row.customers) ? row.customers[0] : row.customers;
    const boat = Array.isArray(row.boats) ? row.boats[0] : row.boats;
    const emailSafe = String(customer?.email || '').trim().toLowerCase();
    if (!emailSafe) continue;

    const result = await sendRocketDepartureConfirmedEmail({
      supabase,
      resend,
      resendFrom,
      booking: row,
      customer,
      boat,
      bookingId: row.id,
      emailSafe,
      source,
      forceResend,
      confirmationHelpers,
      bookingReliability,
      verificationReminder,
      verificationSms,
    });
    if (result.ok && !result.alreadySent) notified += 1;
  }

  return { notified, bookingCount: bookings.length };
}

module.exports = {
  MESSAGE_TYPE_RESERVATION,
  MESSAGE_TYPE_DEPARTURE_CONFIRMED,
  ROCKET_SCHEDULE_NOTICE,
  ROCKET_SHARED_MINIMUM_NOTICE,
  isRocketPackageBooking,
  shouldSendRocketReservationEmail,
  shouldSendRocketDepartureConfirmedEmail,
  buildRocketReservationContent,
  buildRocketDepartureConfirmedContent,
  sendRocketReservationEmail,
  sendRocketDepartureConfirmedEmail,
  maybeNotifyRocketDepartureGroupConfirmed,
};
