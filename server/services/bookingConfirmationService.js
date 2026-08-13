/**
 * Centralized booking confirmation email (Resend).
 */
const { DateTime } = require('luxon');
const bookingCommunications = require('./bookingCommunications');
const {
  googleMapsDirectionsUrl,
  locationText,
  resolveMeetingLocation,
  TITUSVILLE_MEETING_LOCATION,
} = require('../lib/meetingLocations');
const { publicAppBase } = require('./verificationReminder');

const BUSINESS_TZ = String(process.env.BUSINESS_TIMEZONE || 'America/New_York').trim();
const ARRIVAL_MINUTES_EARLY = 15;
const SUPPORT_PHONE = '803-542-1761';
const SUPPORT_PHONE_TEL = 'tel:803-542-1761';

const CONFIRMATION_ELIGIBLE_STATUSES = new Set([
  'pending',
  'pending_verification',
  'confirmed',
  'ready_for_departure',
]);

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : null;
}

function formatDateLabel(iso) {
  const dt = DateTime.fromISO(String(iso || ''), { zone: 'utc' }).setZone(BUSINESS_TZ);
  return dt.isValid ? dt.toFormat('EEEE, MMMM d, yyyy') : '—';
}

function formatTimeLabel(iso) {
  const dt = DateTime.fromISO(String(iso || ''), { zone: 'utc' }).setZone(BUSINESS_TZ);
  return dt.isValid ? dt.toFormat('h:mm a') : '—';
}

function formatTimeRange(startIso, endIso) {
  const start = formatTimeLabel(startIso);
  const end = formatTimeLabel(endIso);
  const startDt = DateTime.fromISO(String(startIso || ''), { zone: 'utc' }).setZone(BUSINESS_TZ);
  const endDt = DateTime.fromISO(String(endIso || ''), { zone: 'utc' }).setZone(BUSINESS_TZ);
  if (!startDt.isValid || !endDt.isValid) return `${start} – ${end}`;
  if (!startDt.hasSame(endDt, 'day')) {
    return `${start} – ${end} (${endDt.toFormat('MMM d')})`;
  }
  return `${start} – ${end}`;
}

function experienceLabel(booking) {
  if (booking.pricing_package_name) return String(booking.pricing_package_name);
  const charterType = String(booking.charter_type || '').trim().toLowerCase();
  if (charterType === 'bio') return 'Bioluminescence Night Tour';
  if (charterType === 'rocket') return 'Rocket Launch Viewing Charter';
  if (charterType === 'sunset') return 'Sunset Cruise';
  if (charterType === 'captain_charter') return 'Captain-Led Charter';
  if (String(booking.booking_type || '') === 'rental') {
    const rentalType = String(booking.rental_type || '').replace(/_/g, ' ');
    return rentalType ? `${rentalType} rental` : 'Boat rental';
  }
  return 'Launch Zone Charters experience';
}

function paymentSummary(booking) {
  const source = String(booking.booking_source || '').trim().toLowerCase();
  const method = String(booking.payment_method || '').trim().toLowerCase();
  if (source === 'groupon' || method === 'groupon') {
    return 'Paid through Groupon — no additional charge today from Launch Zone Charters.';
  }
  const status = String(booking.payment_status || 'pending').replace(/_/g, ' ');
  const deposit = money(booking.deposit_paid ?? booking.deposit_amount);
  const balance = money(booking.balance_due);
  const parts = [`Payment status: ${status}`];
  if (deposit) parts.push(`Deposit paid: ${deposit}`);
  if (balance && Number(booking.balance_due) > 0) parts.push(`Remaining balance: ${balance}`);
  return parts.join(' · ');
}

function beforeYouArriveLines(booking, docsUrl) {
  const lines = [];
  if (!booking.waiver_signed && docsUrl) {
    lines.push(`Complete your waiver before arrival: ${docsUrl}`);
  }
  if (String(booking.booking_type || '') === 'rental') {
    if (booking.license_status !== 'verified' && docsUrl) {
      lines.push(`Upload your driver's license: ${docsUrl}`);
    }
    if (!booking.captain_included && booking.insurance_status !== 'verified' && docsUrl) {
      lines.push(`Submit rental insurance details: ${docsUrl}`);
    }
  }
  if (lines.length === 0) {
    lines.push('Bring a valid photo ID and any documents listed in your booking checklist.');
  }
  return lines;
}

function buildConfirmationContent({ booking, customer, boat, source = 'server' }) {
  const name = customer?.full_name || 'there';
  const meeting = resolveMeetingLocation(booking);
  const mapsUrl = meeting?.address1 ? googleMapsDirectionsUrl(meeting) : null;
  const docsUrl = publicAppBase()
    ? `${publicAppBase().replace(/\/$/, '')}/waivers-insurance?bookingId=${encodeURIComponent(booking.id)}`
    : '';
  const dateLabel = formatDateLabel(booking.start_time);
  const timeRange = formatTimeRange(booking.start_time, booking.end_time);
  const guests = Math.max(1, Number(booking.guest_count || booking.package_guest_count || 1));
  const experience = experienceLabel(booking);
  const boatName = boat?.name || null;
  const paymentLine = paymentSummary(booking);
  const arrivalLines = beforeYouArriveLines(booking, docsUrl);

  const subject = dateLabel && dateLabel !== '—'
    ? `Your Launch Zone Charters Booking is Confirmed — ${dateLabel}`
    : 'Your Launch Zone Charters Booking is Confirmed';

  const textLines = [
    'Booking Confirmed',
    '',
    `Hi ${name},`,
    '',
    'Your Launch Zone Charters reservation is confirmed.',
    '',
    'Trip Details',
    `Date: ${dateLabel}`,
    `Time: ${timeRange}`,
    `Guests: ${guests}`,
    `Experience: ${experience}`,
    boatName ? `Boat: ${boatName}` : null,
    `Booking #: ${booking.id}`,
    paymentLine,
    '',
    'Meeting Point',
    meeting?.name || 'Launch Zone Charters',
    meeting?.address1 || null,
    meeting?.address1
      ? `${meeting.city}, ${meeting.state} ${meeting.postalCode}`
      : meeting?.directionsNote || `${meeting?.city || ''}, ${meeting?.state || ''}`.trim(),
    meeting?.meetingInstructions || null,
    mapsUrl ? `Get Directions: ${mapsUrl}` : null,
    '',
    'Arrival',
    `Please arrive about ${ARRIVAL_MINUTES_EARLY} minutes before your scheduled departure.`,
    meeting?.directionsNote || null,
    '',
    'Before You Arrive',
    ...arrivalLines,
    docsUrl ? `Document checklist: ${docsUrl}` : null,
    '',
    'What to Bring',
    'Valid photo ID, comfortable clothing, and anything noted in your trip checklist.',
    'For night tours, dim red lighting helps your eyes adjust to the bioluminescence.',
    '',
    `Questions? Call ${SUPPORT_PHONE}.`,
    '',
    `Booking source: ${source}`,
  ].filter(Boolean);

  const textBody = textLines.join('\n');

  const meetingAddressHtml = meeting?.address1
    ? `<p style="margin:0 0 4px;font-size:16px;line-height:1.5;color:#0f172a;">${escapeHtml(meeting.address1)}</p>
       <p style="margin:0;font-size:16px;line-height:1.5;color:#0f172a;">${escapeHtml(meeting.city)}, ${escapeHtml(meeting.state)} ${escapeHtml(meeting.postalCode)}</p>`
    : `<p style="margin:0;font-size:15px;line-height:1.5;color:#475569;">${escapeHtml(meeting?.directionsNote || 'Contact us for exact ramp details before departure.')}</p>`;

  const directionsButton = mapsUrl
    ? `<p style="margin:20px 0 0;">
         <a href="${escapeHtml(mapsUrl)}" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;font-weight:700;font-size:18px;line-height:1.2;padding:16px 28px;border-radius:12px;">Get Directions</a>
       </p>
       <p style="margin:12px 0 0;font-size:13px;line-height:1.4;color:#64748b;word-break:break-all;">${escapeHtml(mapsUrl)}</p>`
    : '';

  const htmlBody = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
        <tr><td style="background:#0f172a;color:#ffffff;padding:24px 28px;">
          <p style="margin:0 0 8px;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#94a3b8;">Launch Zone Charters</p>
          <h1 style="margin:0;font-size:28px;line-height:1.2;">Booking Confirmed</h1>
        </td></tr>
        <tr><td style="padding:28px;">
          <p style="margin:0 0 18px;font-size:16px;line-height:1.6;">Hi ${escapeHtml(name)}, your reservation is confirmed.</p>
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin-bottom:20px;">
            <p style="margin:0 0 12px;font-size:13px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#64748b;">Trip Details</p>
            <p style="margin:0 0 8px;font-size:24px;line-height:1.3;font-weight:700;color:#0f172a;">${escapeHtml(dateLabel)}</p>
            <p style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#0f766e;font-weight:700;">${escapeHtml(timeRange)}</p>
            <p style="margin:0 0 6px;font-size:15px;"><strong>Guests:</strong> ${escapeHtml(String(guests))}</p>
            <p style="margin:0 0 6px;font-size:15px;"><strong>Experience:</strong> ${escapeHtml(experience)}</p>
            ${boatName ? `<p style="margin:0 0 6px;font-size:15px;"><strong>Boat:</strong> ${escapeHtml(boatName)}</p>` : ''}
            <p style="margin:0 0 6px;font-size:15px;"><strong>Booking #:</strong> ${escapeHtml(booking.id)}</p>
            <p style="margin:0;font-size:14px;line-height:1.5;color:#475569;">${escapeHtml(paymentLine)}</p>
          </div>
          <div style="background:#ecfeff;border:1px solid #99f6e4;border-radius:12px;padding:20px;margin-bottom:20px;">
            <p style="margin:0 0 12px;font-size:13px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#0f766e;">Meeting Point</p>
            <p style="margin:0 0 8px;font-size:18px;line-height:1.4;font-weight:700;color:#0f172a;">${escapeHtml(meeting?.name || 'Launch Zone Charters')}</p>
            ${meetingAddressHtml}
            ${
              meeting?.meetingInstructions
                ? `<p style="margin:12px 0 0;font-size:15px;line-height:1.6;color:#334155;">${escapeHtml(meeting.meetingInstructions)}</p>`
                : ''
            }
            ${directionsButton}
          </div>
          <div style="margin-bottom:20px;">
            <p style="margin:0 0 8px;font-size:13px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#64748b;">Arrival</p>
            <p style="margin:0;font-size:15px;line-height:1.6;">Please arrive about <strong>${ARRIVAL_MINUTES_EARLY} minutes</strong> before your scheduled departure.</p>
          </div>
          <div style="margin-bottom:20px;">
            <p style="margin:0 0 8px;font-size:13px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#64748b;">Before You Arrive</p>
            ${arrivalLines.map((line) => `<p style="margin:0 0 8px;font-size:15px;line-height:1.6;">${escapeHtml(line)}</p>`).join('')}
            ${docsUrl ? `<p style="margin:8px 0 0;"><a href="${escapeHtml(docsUrl)}" style="color:#0f766e;font-weight:700;">Open your document checklist</a></p>` : ''}
          </div>
          <p style="margin:0;font-size:15px;line-height:1.6;">Questions? Call <a href="${SUPPORT_PHONE_TEL}" style="color:#0f766e;font-weight:700;">${SUPPORT_PHONE}</a>.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return {
    subject,
    textBody,
    htmlBody,
    meeting,
    mapsUrl,
    docsUrl,
  };
}

async function loadBookingForConfirmation(supabase, bookingId) {
  const { data: booking, error } = await supabase
    .from('bookings')
    .select(
      'id, customer_id, boat_id, start_time, end_time, status, payment_status, payment_method, booking_source, booking_type, charter_type, charter_seating, rental_type, rental_location, guest_count, package_guest_count, pricing_package_name, pricing_package_id, is_night_tour, captain_included, waiver_signed, license_status, insurance_status, deposit_paid, deposit_amount, balance_due, total_price, final_total, final_amount_cents, booking_confirmation_sent_at, boats(id, name, type), customers(id, full_name, email, phone)'
    )
    .eq('id', bookingId)
    .maybeSingle();
  if (error) throw error;
  if (!booking?.id) {
    const err = new Error('Booking not found');
    err.statusCode = 404;
    throw err;
  }
  const customer = Array.isArray(booking.customers) ? booking.customers[0] : booking.customers;
  const boat = Array.isArray(booking.boats) ? booking.boats[0] : booking.boats;
  return { booking, customer, boat };
}

async function sendBookingConfirmation({
  supabase,
  resend,
  resendFrom,
  bookingId,
  email = null,
  source = 'server',
  forceResend = false,
  verifyEmailMatch = true,
  bookingReliability = null,
  verificationReminder = null,
  verificationSms = null,
}) {
  const bookingIdSafe = String(bookingId || '').trim();
  const { booking, customer, boat } = await loadBookingForConfirmation(supabase, bookingIdSafe);

  if (!CONFIRMATION_ELIGIBLE_STATUSES.has(String(booking.status || ''))) {
    const err = new Error('Booking is not eligible for confirmation email');
    err.statusCode = 400;
    throw err;
  }

  let emailSafe = email ? String(email).trim().toLowerCase() : '';
  if (verifyEmailMatch && emailSafe && String(customer?.email || '').trim().toLowerCase() !== emailSafe) {
    const err = new Error('Email does not match this booking');
    err.statusCode = 403;
    throw err;
  }
  emailSafe = String(customer?.email || '').trim().toLowerCase();
  if (!emailSafe) {
    const err = new Error('Could not resolve customer email');
    err.statusCode = 400;
    throw err;
  }

  if (booking.booking_confirmation_sent_at && !forceResend) {
    return { ok: true, alreadySent: true, email: emailSafe };
  }

  if (!resend || !resendFrom) {
    const err = new Error('Email service not configured');
    err.statusCode = 503;
    throw err;
  }

  const content = buildConfirmationContent({ booking, customer, boat, source });

  const customerResult = await resend.emails.send({
    from: resendFrom,
    to: emailSafe,
    subject: content.subject,
    text: content.textBody,
    html: content.htmlBody,
  });

  if (customerResult.error) {
    console.error('[booking-confirmation] Resend customer error:', {
      bookingId: bookingIdSafe,
      source,
      code: customerResult.error?.name || 'resend_error',
      message: customerResult.error?.message || 'Failed to send customer email',
    });
    const err = new Error(customerResult.error.message || 'Failed to send customer email');
    err.statusCode = 500;
    throw err;
  }

  const adminTo = String(process.env.ADMIN_EMAIL || '').trim();
  if (adminTo) {
    resend.emails
      .send({
        from: resendFrom,
        to: adminTo,
        subject: `New booking confirmed — ${content.subject}`,
        text: [`Booking ID: ${bookingIdSafe}`, `Customer: ${emailSafe}`, `Source: ${source}`, '', content.textBody].join('\n'),
      })
      .catch((adminErr) => {
        console.error('[booking-confirmation] admin notify failed:', adminErr?.message || adminErr);
      });
  }

  await bookingCommunications.logAutomatedCommunication(supabase, {
    bookingId: bookingIdSafe,
    channel: 'email',
    messageType: forceResend ? 'booking_confirmation' : 'automated_booking_confirmation',
    recipient: emailSafe,
    subject: content.subject,
    body: content.textBody,
    providerMessageId: customerResult.data?.id || null,
  });

  if (!forceResend) {
    await supabase
      .from('bookings')
      .update({ booking_confirmation_sent_at: new Date().toISOString() })
      .eq('id', bookingIdSafe)
      .is('booking_confirmation_sent_at', null);
  }

  if (bookingReliability) {
    await bookingReliability.insertActivity(supabase, {
      booking_id: bookingIdSafe,
      event_type: 'emails_sent',
      message: forceResend ? 'Booking confirmation email resent.' : 'Booking confirmation email sent.',
      payload: { source, email: emailSafe, forceResend },
    });
  }

  if (verificationReminder) {
    try {
      await verificationReminder.maybeSendVerificationReminder({
        supabaseAdmin: supabase,
        resend,
        resendFrom,
        bookingId: bookingIdSafe,
        email: emailSafe,
      });
    } catch (remErr) {
      console.error('[booking-confirmation] verification reminder:', remErr?.message || remErr);
    }
  }

  if (verificationSms) {
    try {
      await verificationSms.maybeSendVerificationSms({
        supabaseAdmin: supabase,
        bookingId: bookingIdSafe,
        email: emailSafe,
        publicAppBase: publicAppBase(),
      });
    } catch (_smsErr) {
      /* optional */
    }
  }

  console.info(
    '[booking-confirmation]',
    JSON.stringify({
      bookingId: bookingIdSafe,
      source,
      email: emailSafe,
      forceResend,
      meetingLocationId: content.meeting?.id || null,
      sent: true,
    })
  );

  return { ok: true, alreadySent: false, email: emailSafe, subject: content.subject };
}

module.exports = {
  ARRIVAL_MINUTES_EARLY,
  TITUSVILLE_MEETING_LOCATION,
  buildConfirmationContent,
  googleMapsDirectionsUrl,
  locationText,
  resolveMeetingLocation,
  sendBookingConfirmation,
  loadBookingForConfirmation,
};
