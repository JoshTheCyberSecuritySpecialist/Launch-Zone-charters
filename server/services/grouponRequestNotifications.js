/**
 * Customer + admin notifications when a Groupon booking request is submitted (pending admin review).
 */
const bookingCommunications = require('./bookingCommunications');
const bookingReliability = require('./bookingReliability');
const { sendSMS, normalizePhoneE164 } = require('./sms');
const { publicAppBase } = require('./verificationReminder');

function adminBookingUrl(bookingId) {
  const base = publicAppBase();
  if (!base) return null;
  return `${base.replace(/\/$/, '')}/admin/bookings/${encodeURIComponent(bookingId)}`;
}

function formatTripWhen(startIso) {
  const d = new Date(String(startIso || ''));
  if (!Number.isFinite(d.getTime())) return 'your requested time';
  const date = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${date} at ${time}`;
}

async function hasActivityEvent(supabase, bookingId, eventType) {
  const { data, error } = await supabase
    .from('booking_activity_events')
    .select('id')
    .eq('booking_id', bookingId)
    .eq('event_type', eventType)
    .limit(1)
    .maybeSingle();
  if (error) return false;
  return Boolean(data?.id);
}

async function sendGrouponRequestReceivedNotifications(supabase, deps, { bookingId, customerName, guestCount, startTime }) {
  const bookingIdSafe = String(bookingId || '').trim();
  if (!bookingIdSafe) return { customerEmail: false, customerSms: false, adminEmail: false };

  const { resend, resendFrom } = deps || {};
  const tripWhen = formatTripWhen(startTime);
  const guests = Math.max(1, Number(guestCount || 1));

  let customerEmailSent = false;
  let customerSmsSent = false;
  let adminEmailSent = false;

  const alreadyCustomerEmail = await bookingCommunications.recentSuccessfulCommunication(
    supabase,
    bookingIdSafe,
    'groupon_request_received',
    'email'
  );

  if (!alreadyCustomerEmail) {
    const { data: bookingRow, error: bookingError } = await supabase
      .from('bookings')
      .select('id, start_time, end_time, guest_count, status, booking_source, customers(full_name, email, phone)')
      .eq('id', bookingIdSafe)
      .maybeSingle();

    if (!bookingError && bookingRow) {
      const preview = bookingCommunications.templateFor('groupon_request_received', { booking: bookingRow });
      if (resend && resendFrom && preview.recipients.email) {
        const emailResult = await bookingCommunications.sendEmail({
          supabase,
          resend,
          resendFrom,
          bookingId: bookingIdSafe,
          adminUserId: null,
          preview,
        });
        customerEmailSent = emailResult?.status === 'sent';
      }

      const phone = normalizePhoneE164(preview.recipients.phone || preview.recipients.rawPhone);
      if (phone && bookingCommunications.smsConfigured()) {
        const alreadySms = await bookingCommunications.recentSuccessfulCommunication(
          supabase,
          bookingIdSafe,
          'groupon_request_received',
          'sms'
        );
        if (!alreadySms) {
          const smsResult = await bookingCommunications.sendSms({
            supabase,
            bookingId: bookingIdSafe,
            adminUserId: null,
            preview,
          });
          customerSmsSent = smsResult?.status === 'sent';
        }
      }
    }
  }

  const alreadyAdminNotified = await hasActivityEvent(supabase, bookingIdSafe, 'groupon_admin_notified');
  if (!alreadyAdminNotified) {
    const adminTo = String(process.env.ADMIN_EMAIL || '').trim();
    const reviewUrl = adminBookingUrl(bookingIdSafe);
    const subject = 'New Groupon booking request';
    const textBody = [
      'New Groupon booking request',
      '',
      `${customerName || 'A customer'} requested ${tripWhen} for ${guests} guest${guests === 1 ? '' : 's'}.`,
      '',
      'Review the request in the admin calendar.',
      reviewUrl ? `Open booking: ${reviewUrl}` : `Booking ID: ${bookingIdSafe}`,
      '',
      'Status: Pending review — not confirmed until you approve.',
    ].join('\n');

    if (resend && resendFrom && adminTo) {
      try {
        const result = await resend.emails.send({
          from: resendFrom,
          to: adminTo,
          subject,
          text: textBody,
        });
        if (!result.error) adminEmailSent = true;
        else console.error('[groupon-request-notify] admin Resend error:', result.error);
      } catch (err) {
        console.error('[groupon-request-notify] admin email failed:', err?.message || err);
      }
    } else if (!adminTo) {
      console.warn('[groupon-request-notify] ADMIN_EMAIL not set; admin notify skipped');
    }

    const adminPhone = String(process.env.ADMIN_PHONE || process.env.ADMIN_SMS_PHONE || '').trim();
    if (adminPhone && bookingCommunications.smsConfigured()) {
      const smsBody = `Launch Zone: New Groupon request — ${customerName || 'Customer'}, ${tripWhen}, ${guests} guests. Pending review.${reviewUrl ? ` ${reviewUrl}` : ''}`;
      try {
        await sendSMS(adminPhone, smsBody);
      } catch (err) {
        console.warn('[groupon-request-notify] admin SMS failed:', err?.message || err);
      }
    }

    await bookingReliability.insertActivity(supabase, {
      booking_id: bookingIdSafe,
      event_type: 'groupon_admin_notified',
      actor_type: 'system',
      message: 'Admin notified about new Groupon booking request.',
      payload: {
        adminEmailSent,
        customerEmailSent,
        customerSmsSent,
        guestCount: guests,
      },
    });
  }

  return { customerEmail: customerEmailSent, customerSms: customerSmsSent, adminEmail: adminEmailSent };
}

module.exports = {
  sendGrouponRequestReceivedNotifications,
  adminBookingUrl,
  formatTripWhen,
};
