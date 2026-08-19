const { sendSMS, normalizePhoneE164 } = require('./sms');
const { publicAppBase } = require('./verificationReminder');

const MESSAGE_TYPES = new Set([
  'booking_confirmation',
  'booking_updated',
  'hold_confirmation',
  'missing_waiver',
  'missing_insurance',
  'missing_documents',
  'day_before_reminder',
  'ready_for_departure',
  'cancelled_booking',
  'weather_delay',
  'arrival_instructions',
  'passenger_weight_issue',
  'separate_trip_explanation',
  'groupon_support',
  'groupon_request_received',
  'groupon_request_rejected',
  'groupon_alternative_proposed',
  'rocket_launch_reservation_received',
  'rocket_launch_departure_confirmed',
]);

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : '$0.00';
}

function dateLabel(iso) {
  const d = new Date(String(iso || ''));
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : '';
}

function timeLabel(iso) {
  const d = new Date(String(iso || ''));
  return Number.isFinite(d.getTime()) ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
}

function waiversUrl(bookingId) {
  const base = publicAppBase();
  return base ? `${base.replace(/\/$/, '')}/waivers-insurance?bookingId=${encodeURIComponent(bookingId)}` : '';
}

function detailContext(detail) {
  const booking = detail.booking || {};
  const customer = Array.isArray(booking.customers) ? booking.customers[0] : booking.customers || {};
  const boat = Array.isArray(booking.boats) ? booking.boats[0] : booking.boats || {};
  const docsUrl = waiversUrl(booking.id);
  return {
    booking,
    customer,
    boat,
    name: customer.full_name || booking.name || 'there',
    email: String(customer.email || booking.email || '').trim().toLowerCase(),
    phone: String(customer.phone || booking.phone || '').trim(),
    date: dateLabel(booking.start_time),
    start: timeLabel(booking.start_time),
    end: timeLabel(booking.end_time),
    boatName: boat.name || 'your boat',
    location: booking.rental_location || 'Launch Zone',
    passengers: booking.guest_count || booking.passenger_count || 1,
    paymentStatus: String(booking.payment_status || 'pending').replace(/_/g, ' '),
    remainingBalance: money(booking.balance_due),
    bioPackageLine: booking.pricing_package_name
      ? `${booking.pricing_package_name} — ${booking.package_guest_count || booking.guest_count || 1} guests — ${money(
          booking.final_amount_cents != null
            ? Number(booking.final_amount_cents) / 100
            : booking.final_total ?? booking.total_price
        )} paid`
      : booking.charter_type === 'bio' && !booking.pricing_package_id
        ? 'Legacy bioluminescence pricing'
        : null,
    holdExpires: booking.hold_expires_at ? `${dateLabel(booking.hold_expires_at)} at ${timeLabel(booking.hold_expires_at)}` : '',
    docsUrl,
    waiverUrl: docsUrl,
    insuranceUrl: docsUrl,
  };
}

function baseTripLines(ctx) {
  const lines = [
    `Date: ${ctx.date}`,
    `Time: ${ctx.start} - ${ctx.end}`,
    `Boat: ${ctx.boatName}`,
    `Location: ${ctx.location}`,
    `Passengers: ${ctx.passengers}`,
  ];
  if (ctx.bioPackageLine) {
    lines.push(`Package: ${ctx.bioPackageLine}`);
  }
  lines.push(`Payment status: ${ctx.paymentStatus}`);
  lines.push(`Remaining balance: ${ctx.remainingBalance}`);
  return lines;
}

function templateFor(type, detail) {
  if (!MESSAGE_TYPES.has(type)) {
    const err = new Error('Unknown communication message type.');
    err.statusCode = 400;
    throw err;
  }
  const ctx = detailContext(detail);
  const docsBlock = [
    `Waiver link: ${ctx.waiverUrl || 'Unavailable'}`,
    `Insurance link: ${ctx.insuranceUrl || 'Unavailable'}`,
    `Document checklist: ${ctx.docsUrl || 'Unavailable'}`,
  ];

  const templates = {
    booking_confirmation: {
      subject: 'Your Launch Zone Charters booking confirmation',
      intro: `Hi ${ctx.name}, your Launch Zone Charters booking is confirmed.`,
      sms: `Launch Zone: Your booking is confirmed for ${ctx.date} ${ctx.start}-${ctx.end} on ${ctx.boatName}. Docs/checklist: ${ctx.docsUrl}`,
    },
    booking_updated: {
      subject: 'Updated details for your Launch Zone Charters booking',
      intro: `Hi ${ctx.name}, we updated your Launch Zone Charters booking. Here are the current trip details:`,
      sms: `Launch Zone: Your booking was updated. ${ctx.date} ${ctx.start}-${ctx.end} on ${ctx.boatName} at ${ctx.location}. Questions? Call 803-542-1761.`,
    },
    hold_confirmation: {
      subject: 'Your Launch Zone Charters hold',
      intro: `Hi ${ctx.name}, we saved a temporary hold for your trip.`,
      extra: ctx.holdExpires ? [`Hold expires: ${ctx.holdExpires}`, 'Please contact us to confirm before the hold expires.'] : ['Please contact us to confirm this hold.'],
      sms: `Launch Zone: Your hold is saved for ${ctx.date} ${ctx.start}-${ctx.end} on ${ctx.boatName}.${ctx.holdExpires ? ` Expires ${ctx.holdExpires}.` : ''} Call us to confirm.`,
    },
    missing_waiver: {
      subject: 'Reminder: Launch Zone waiver needed',
      intro: `Hi ${ctx.name}, we still need your waiver before your trip.`,
      extra: [`Complete it here: ${ctx.waiverUrl || 'Unavailable'}`],
      sms: `Launch Zone reminder: Please complete your waiver before your trip: ${ctx.waiverUrl}`,
    },
    missing_insurance: {
      subject: 'Reminder: rental insurance needed',
      intro: `Hi ${ctx.name}, we still need your rental insurance details before your trip.`,
      extra: [`Upload or review insurance here: ${ctx.insuranceUrl || 'Unavailable'}`],
      sms: `Launch Zone reminder: Please upload your rental insurance before your trip: ${ctx.insuranceUrl}`,
    },
    missing_documents: {
      subject: 'Reminder: trip documents needed',
      intro: `Hi ${ctx.name}, we still need your license/documents or checklist before your trip.`,
      extra: [`Upload documents here: ${ctx.docsUrl || 'Unavailable'}`],
      sms: `Launch Zone reminder: Please finish your trip documents/checklist here: ${ctx.docsUrl}`,
    },
    day_before_reminder: {
      subject: 'Reminder: your Launch Zone trip is tomorrow',
      intro: `Hi ${ctx.name}, this is your day-before reminder for tomorrow's trip.`,
      extra: docsBlock,
      sms: `Launch Zone reminder: Your trip is tomorrow ${ctx.start}-${ctx.end} on ${ctx.boatName} at ${ctx.location}. Checklist: ${ctx.docsUrl}`,
    },
    ready_for_departure: {
      subject: 'You are ready for departure',
      intro: `Hi ${ctx.name}, your booking is marked ready for departure.`,
      extra: ['Please arrive a few minutes early and bring any required ID/documents.'],
      sms: `Launch Zone: You are ready for departure for ${ctx.date} ${ctx.start}. See you at ${ctx.location}.`,
    },
    cancelled_booking: {
      subject: 'Your Launch Zone Charters booking was cancelled',
      intro: `Hi ${ctx.name}, your Launch Zone Charters booking has been cancelled.`,
      extra: ['If you have questions or need to rebook, please contact us.'],
      sms: `Launch Zone: Your booking for ${ctx.date} ${ctx.start} has been cancelled. Contact us with questions or to rebook.`,
    },
    weather_delay: {
      subject: 'Weather update for your Launch Zone Charters trip',
      intro: `Hi ${ctx.name}, we are monitoring weather for your upcoming trip and may adjust departure timing for safety.`,
      extra: ['We will contact you if your departure time changes. You can also call 803-542-1761 for the latest update.'],
      sms: `Launch Zone: Weather update for your ${ctx.date} trip. We will contact you if departure time changes. Call 803-542-1761.`,
    },
    arrival_instructions: {
      subject: 'Arrival instructions for your Launch Zone Charters trip',
      intro: `Hi ${ctx.name}, here are arrival instructions for your upcoming trip.`,
      extra: [
        'Please arrive 15 minutes early.',
        'Bring a valid ID and any required waiver or insurance documents.',
        `Location: ${ctx.location}`,
      ],
      sms: `Launch Zone: Arrive 15 min early for ${ctx.date} ${ctx.start}. Location: ${ctx.location}. Docs: ${ctx.docsUrl}`,
    },
    passenger_weight_issue: {
      subject: 'Passenger or weight information needed for your trip',
      intro: `Hi ${ctx.name}, we need updated passenger or weight details before your trip for safety compliance.`,
      extra: ['Please contact us or update your waiver/passenger information as soon as possible.'],
      sms: `Launch Zone: We need updated passenger/weight info before your ${ctx.date} trip. Call 803-542-1761.`,
    },
    separate_trip_explanation: {
      subject: 'Important update about your Launch Zone Charters booking',
      intro: `Hi ${ctx.name}, we need to discuss a separate-trip arrangement for your booking.`,
      extra: ['Please contact us at 803-542-1761 so we can review the best option for your group.'],
      sms: `Launch Zone: Please call 803-542-1761 about a separate-trip arrangement for your ${ctx.date} booking.`,
    },
    groupon_support: {
      subject: 'Groupon voucher support for your Launch Zone Charters booking',
      intro: `Hi ${ctx.name}, we are following up about your Groupon voucher booking.`,
      extra: [
        'If you need help with voucher verification, rescheduling, or refund questions, contact us and reference your booking ID.',
        'Groupon refund requests must be handled through Groupon customer support when applicable.',
      ],
      sms: `Launch Zone Groupon support: Call 803-542-1761 about booking ${ctx.booking.id}. Have your voucher last four ready.`,
    },
    groupon_request_received: {
      subject: 'Groupon booking request received — awaiting approval',
      intro: `Hi ${ctx.name}, your Groupon booking request has been received.`,
      extra: [
        'Your requested date and time are not confirmed yet.',
        'Launch Zone Charters will review boat, captain, capacity, and schedule availability.',
        'You will receive confirmation or an alternate-time message after review.',
        'Do not arrive until you receive a confirmed reservation.',
        `Status: Pending review`,
      ],
      sms: `Launch Zone: Groupon request received for ${ctx.date} ${ctx.start}. Pending admin approval — not confirmed yet. Do not arrive until confirmed. Questions? 803-542-1761.`,
    },
    groupon_request_rejected: {
      subject: 'Update on your Groupon booking request',
      intro: `Hi ${ctx.name}, we reviewed your Groupon booking request and cannot confirm the requested time.`,
      extra: [
        'Your reservation is not confirmed.',
        'If you purchased through Groupon, contact us at 803-542-1761 to discuss alternate dates or refund options through Groupon when applicable.',
      ],
      sms: `Launch Zone: Your Groupon request for ${ctx.date} ${ctx.start} could not be confirmed. Call 803-542-1761 to discuss options.`,
    },
    groupon_alternative_proposed: {
      subject: 'Alternate time proposed for your Groupon booking request',
      intro: `Hi ${ctx.name}, we reviewed your Groupon booking request and would like to offer a different departure time.`,
      extra: [
        `Proposed date: ${ctx.date}`,
        `Proposed time: ${ctx.start} - ${ctx.end}`,
        'Please contact us at 803-542-1761 to accept or decline this alternate time.',
        'Your trip is not confirmed until you accept and we send final confirmation.',
      ],
      sms: `Launch Zone: Alternate Groupon time proposed — ${ctx.date} ${ctx.start}. Call 803-542-1761 to accept or decline. Not confirmed until you hear back.`,
    },
  };

  const selected = templates[type];
  const lines = [selected.intro, '', ...baseTripLines(ctx), '', ...(selected.extra || docsBlock), '', `Booking ID: ${ctx.booking.id}`, 'Questions? Call 803-542-1761.'];
  const text = lines.filter((line) => line != null).join('\n');
  const html = text
    .split('\n')
    .map((line) => (line ? `<p>${escapeHtml(line)}</p>` : '<br>'))
    .join('');
  return {
    messageType: type,
    subject: selected.subject,
    emailBody: text,
    emailHtml: html,
    smsBody: selected.sms,
    recipients: {
      email: ctx.email,
      phone: normalizePhoneE164(ctx.phone),
      rawPhone: ctx.phone,
    },
  };
}

function smsConfigured() {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER);
}

async function recentSuccessfulCommunication(supabase, bookingId, messageType, channel) {
  const { data, error } = await supabase
    .from('booking_communications')
    .select('id, sent_at, created_at, recipient, status')
    .eq('booking_id', bookingId)
    .eq('message_type', messageType)
    .eq('channel', channel)
    .eq('status', 'sent')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return data || null;
}

async function logCommunication(supabase, entry) {
  const { data, error } = await supabase.from('booking_communications').insert(entry).select('*').single();
  if (error) throw error;
  return data;
}

async function logAutomatedCommunication(
  supabase,
  { bookingId, channel = 'email', messageType, recipient, subject, body, status = 'sent', providerMessageId = null, errorMessage = null }
) {
  if (!supabase || !bookingId || !messageType) return null;
  try {
    return await logCommunication(supabase, {
      booking_id: bookingId,
      channel,
      message_type: messageType,
      recipient: String(recipient || '').trim(),
      subject: subject || null,
      body: body || '',
      sent_by: null,
      sent_at: status === 'sent' ? new Date().toISOString() : null,
      status,
      provider_message_id: providerMessageId || null,
      error_message: errorMessage || null,
    });
  } catch (err) {
    console.warn('[booking-communications] automated log failed:', err.message || err);
    return null;
  }
}

async function sendEmail({ supabase, resend, resendFrom, bookingId, adminUserId, preview }) {
  const recipient = preview.recipients.email;
  if (!recipient) {
    return logCommunication(supabase, {
      booking_id: bookingId,
      channel: 'email',
      message_type: preview.messageType,
      recipient: '',
      subject: preview.subject,
      body: preview.emailBody,
      sent_by: adminUserId,
      status: 'skipped',
      error_message: 'Missing customer email',
    });
  }
  if (!resend || !resendFrom) {
    return logCommunication(supabase, {
      booking_id: bookingId,
      channel: 'email',
      message_type: preview.messageType,
      recipient,
      subject: preview.subject,
      body: preview.emailBody,
      sent_by: adminUserId,
      status: 'failed',
      error_message: 'Email service not configured',
    });
  }

  const result = await resend.emails.send({
    from: resendFrom,
    to: recipient,
    subject: preview.subject,
    text: preview.emailBody,
    html: preview.emailHtml,
  });
  const failed = result.error;
  return logCommunication(supabase, {
    booking_id: bookingId,
    channel: 'email',
    message_type: preview.messageType,
    recipient,
    subject: preview.subject,
    body: preview.emailBody,
    sent_by: adminUserId,
    sent_at: failed ? null : new Date().toISOString(),
    status: failed ? 'failed' : 'sent',
    provider_message_id: result.data?.id || null,
    error_message: failed ? result.error?.message || 'Resend failed' : null,
  });
}

async function sendSms({ supabase, bookingId, adminUserId, preview }) {
  const recipient = preview.recipients.phone || preview.recipients.rawPhone || '';
  if (!recipient) {
    return logCommunication(supabase, {
      booking_id: bookingId,
      channel: 'sms',
      message_type: preview.messageType,
      recipient: '',
      body: preview.smsBody,
      sent_by: adminUserId,
      status: 'skipped',
      error_message: 'Missing customer phone',
    });
  }
  const result = await sendSMS(recipient, preview.smsBody);
  return logCommunication(supabase, {
    booking_id: bookingId,
    channel: 'sms',
    message_type: preview.messageType,
    recipient,
    body: preview.smsBody,
    sent_by: adminUserId,
    sent_at: result.ok ? new Date().toISOString() : null,
    status: result.ok ? 'sent' : result.skipped ? 'skipped' : 'failed',
    provider_message_id: result.sid || null,
    error_message: result.ok ? null : result.skipped ? 'SMS service not configured or invalid phone' : 'SMS send failed',
  });
}

module.exports = {
  MESSAGE_TYPES,
  templateFor,
  smsConfigured,
  recentSuccessfulCommunication,
  logAutomatedCommunication,
  sendEmail,
  sendSms,
};
