const { formatRefundPolicyText } = require('../content/cancellationRefundPolicy');

const RESEND_FROM = 'Launch Zone Charters';

const SYSTEM_FLAG_CONFIG = [
  {
    field: 'booking_confirmation_sent_at',
    messageTypes: ['automated_booking_confirmation', 'booking_confirmation'],
    channel: 'email',
    label: 'Booking confirmation email',
    sender: RESEND_FROM,
  },
  {
    field: 'verification_reminder_sent_at',
    messageTypes: ['automated_verification_reminder'],
    channel: 'email',
    label: 'Verification reminder email',
    sender: RESEND_FROM,
  },
  {
    field: 'verification_sms_sent_at',
    messageTypes: ['automated_verification_sms'],
    channel: 'sms',
    label: 'Verification SMS',
    sender: RESEND_FROM,
  },
  {
    field: 'insurance_reminder_24h_sent_at',
    messageTypes: ['automated_insurance_reminder_24h'],
    channel: 'email',
    label: 'Insurance reminder email (24 hours before trip)',
    sender: RESEND_FROM,
  },
  {
    field: 'insurance_reminder_2h_sent_at',
    messageTypes: ['automated_insurance_reminder_2h'],
    channel: 'email',
    label: 'Insurance reminder email (2 hours before trip)',
    sender: RESEND_FROM,
  },
  {
    field: 'waivers_docs_reminder_sent_at',
    messageTypes: ['automated_waivers_docs_reminder'],
    channel: 'email',
    label: 'Waivers/documents reminder email',
    sender: RESEND_FROM,
  },
  {
    field: 'waivers_docs_confirmation_sent_at',
    messageTypes: ['automated_pre_trip_confirmation'],
    channel: 'email',
    label: 'Pre-trip documents confirmation email',
    sender: RESEND_FROM,
  },
];

function safeText(value, max = 2000) {
  const s = String(value || '').trim();
  return s.length > max ? `${s.slice(0, max)}...` : s;
}

function money(value, currency = 'usd') {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return '$0.00';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: String(currency || 'usd').toUpperCase(),
  }).format(n);
}

function formatDateTime(value) {
  if (!value) return 'Not recorded';
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toLocaleString('en-US') : 'Not recorded';
}

function section(title, lines) {
  return [`=== ${title} ===`, ...lines.filter((line) => line != null), ''].join('\n');
}

function previewBody(body, max = 240) {
  const text = safeText(body, max);
  return text || 'Not recorded';
}

function hasLoggedCommunication(communications, messageTypes) {
  const types = new Set(messageTypes);
  return communications.some((row) => types.has(String(row.message_type || '')));
}

function activityTimelineLabel(event) {
  const type = String(event.event_type || '').replace(/_/g, ' ');
  const message = event.message ? `: ${event.message}` : '';
  return `${type}${message}`;
}

async function fetchReceiptUrl(stripe, chargeId) {
  const id = safeText(chargeId, 120);
  if (!stripe || !id) return null;
  try {
    const charge = await stripe.charges.retrieve(id);
    return charge?.receipt_url || null;
  } catch (err) {
    console.warn('[dispute-evidence] receipt lookup failed:', err.message || err);
    return null;
  }
}

async function loadBookingEvidenceContext(supabase, bookingId) {
  const { data: booking, error } = await supabase
    .from('bookings')
    .select(
      '*, customers(id, full_name, email, phone, id_document_url, insurance_proof_url), boats(id, name, type), waivers(id, electronic_signature, signature_date, ip_address, accepted, created_at), user_verifications(id, buoy_status, buoy_proof_url, created_at, updated_at)'
    )
    .eq('id', bookingId)
    .maybeSingle();
  if (error) throw error;
  if (!booking?.id) return null;
  return booking;
}

async function buildCommunicationTimeline(supabase, bookingId, booking) {
  const [{ data: communications, error: commError }, { data: activity, error: activityError }] = await Promise.all([
    supabase
      .from('booking_communications')
      .select('id, channel, message_type, recipient, subject, body, sent_by, sent_at, status, created_at')
      .eq('booking_id', bookingId)
      .order('created_at', { ascending: true }),
    supabase
      .from('booking_activity_events')
      .select('id, event_type, actor_type, message, created_at')
      .eq('booking_id', bookingId)
      .order('created_at', { ascending: true }),
  ]);
  if (commError) throw commError;
  if (activityError) throw activityError;

  const commRows = Array.isArray(communications) ? communications : [];
  const activityRows = Array.isArray(activity) ? activity : [];
  const entries = [];

  if (booking?.created_at) {
    entries.push({
      timestamp: booking.created_at,
      sender: booking.staff_created ? 'Admin' : 'System',
      recipient: booking.customers?.email || 'Customer',
      subject: 'Booking created',
      preview: booking.staff_created ? 'Booking created by admin.' : 'Booking created via website checkout.',
      source: 'booking_record',
      contentStored: true,
    });
  }

  for (const row of commRows) {
    entries.push({
      timestamp: row.sent_at || row.created_at,
      sender: row.sent_by ? 'Admin' : RESEND_FROM,
      recipient: row.recipient || 'Customer',
      subject: row.subject || row.message_type.replace(/_/g, ' '),
      preview: previewBody(row.body),
      source: 'booking_communications',
      contentStored: Boolean(String(row.body || '').trim()),
      channel: row.channel,
      status: row.status,
    });
  }

  for (const flag of SYSTEM_FLAG_CONFIG) {
    const sentAt = booking?.[flag.field];
    if (!sentAt) continue;
    if (hasLoggedCommunication(commRows, flag.messageTypes)) continue;
    entries.push({
      timestamp: sentAt,
      sender: flag.sender,
      recipient: booking?.customers?.email || booking?.customers?.phone || 'Customer',
      subject: flag.label,
      preview: 'Sent (content not stored)',
      source: 'system_flag',
      contentStored: false,
      channel: flag.channel,
    });
  }

  for (const event of activityRows) {
    if (['webhook_received', 'booking_modified'].includes(String(event.event_type || ''))) continue;
    entries.push({
      timestamp: event.created_at,
      sender: event.actor_type === 'admin' ? 'Admin' : 'System',
      recipient: 'Internal',
      subject: activityTimelineLabel(event),
      preview: safeText(event.message, 240) || 'System event recorded.',
      source: 'booking_activity_events',
      contentStored: true,
    });
  }

  entries.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  return entries;
}

function documentLines(booking, customer) {
  const lines = [];
  const waiver = Array.isArray(booking.waivers) ? booking.waivers[0] : booking.waivers;
  lines.push(`Waiver signed: ${booking.waiver_signed ? 'Yes' : 'No'}`);
  if (booking.waiver_signed_at) lines.push(`Waiver signed at: ${formatDateTime(booking.waiver_signed_at)}`);
  if (waiver?.signature_date) lines.push(`Waiver signature date: ${formatDateTime(waiver.signature_date)}`);
  if (waiver?.ip_address) lines.push(`Waiver IP address: ${waiver.ip_address}`);
  else lines.push('Waiver IP address: Not recorded');
  lines.push('Device/browser at waiver signing: Not recorded');

  lines.push(`License on file: ${booking.license_url || customer?.id_document_url ? 'Yes' : 'No'}`);
  lines.push(`License status: ${booking.license_status || 'Not recorded'}`);
  lines.push(`Insurance proof on file: ${booking.insurance_url || customer?.insurance_proof_url ? 'Yes' : 'No'}`);
  lines.push(`Insurance status: ${booking.insurance_status || 'Not recorded'}`);

  const verification = Array.isArray(booking.user_verifications)
    ? booking.user_verifications[0]
    : booking.user_verifications;
  if (verification) {
    lines.push(`Buoy insurance status: ${verification.buoy_status || 'Not recorded'}`);
    lines.push(`Buoy proof on file: ${verification.buoy_proof_url ? 'Yes' : 'No'}`);
  }

  return lines;
}

function agreementLines(booking, waiver) {
  return [
    `Terms accepted: ${booking.terms_accepted ? 'Yes' : 'No'}`,
    `Damage fee acknowledged: ${booking.damage_fee_acknowledged ? 'Yes' : 'No'}`,
    `Waiver signed: ${booking.waiver_signed ? 'Yes' : 'No'}`,
    `Waiver signed at: ${formatDateTime(booking.waiver_signed_at || waiver?.signature_date)}`,
    `Refund policy accepted via waiver: ${booking.waiver_signed ? 'Yes (included in waiver acknowledgment)' : 'Not recorded'}`,
    `Agreement IP address: ${waiver?.ip_address || 'Not recorded'}`,
    `Agreement device/browser: Not recorded`,
  ];
}

function paymentLines(booking, dispute, receiptUrl) {
  return [
    `Stripe Payment Intent: ${booking.payment_intent_id || dispute?.payment_intent_id || 'Not recorded'}`,
    `Stripe Checkout Session: ${booking.checkout_session_id || booking.stripe_payment_id || dispute?.checkout_session_id || 'Not recorded'}`,
    `Stripe Charge ID: ${booking.stripe_charge_id || dispute?.stripe_charge_id || 'Not recorded'}`,
    `Disputed amount: ${money(dispute?.amount ?? booking.deposit_paid ?? booking.total_price, dispute?.currency || 'usd')}`,
    `Deposit paid: ${money(booking.deposit_paid, 'usd')}`,
    `Remaining balance: ${money(booking.balance_due, 'usd')}`,
    `Total price: ${money(booking.final_total ?? booking.total_price, 'usd')}`,
    `Payment status: ${String(booking.payment_status || 'pending').replace(/_/g, ' ')}`,
    `Receipt URL: ${receiptUrl || 'Not available'}`,
  ];
}

function serviceLines(booking, customer, boat) {
  const charterLabel =
    booking.booking_type === 'charter' || booking.captain_included ? 'Captain charter' : 'Boat rental';
  return [
    `Customer: ${customer?.full_name || 'Not recorded'}`,
    `Email: ${customer?.email || 'Not recorded'}`,
    `Phone: ${customer?.phone || 'Not recorded'}`,
    `Customer address: Not stored`,
    `Service: ${charterLabel}`,
    `Boat: ${boat?.name || 'Not recorded'}${boat?.type ? ` (${boat.type})` : ''}`,
    `Trip date: ${formatDateTime(booking.start_time)}`,
    `Trip end: ${formatDateTime(booking.end_time)}`,
    `Duration (hours): ${booking.duration_hours ?? 'Not recorded'}`,
    `Pickup location: ${booking.rental_location || 'Not recorded'}`,
    `Passengers: ${booking.guest_count ?? 'Not recorded'}`,
    `Booking status: ${String(booking.status || 'pending').replace(/_/g, ' ')}`,
    `Booking created: ${formatDateTime(booking.created_at)}`,
  ];
}

function reasonChargeValidLines(booking, dispute) {
  const lines = [
    `Customer completed checkout and payment was processed for this booking.`,
    `Booking status at evidence generation: ${String(booking.status || 'pending').replace(/_/g, ' ')}.`,
    `Payment status: ${String(booking.payment_status || 'pending').replace(/_/g, ' ')}.`,
  ];
  if (booking.terms_accepted) lines.push('Customer accepted terms during booking.');
  if (booking.waiver_signed) lines.push('Customer signed the electronic waiver before the trip.');
  if (dispute?.reason) lines.push(`Stripe dispute reason code: ${dispute.reason.replace(/_/g, ' ')}.`);
  lines.push('Refund eligibility is governed by the cancellation and refund policy accepted by the customer.');
  return lines;
}

function formatTimelineForSummary(entries) {
  if (!entries.length) return ['No communication or activity records found.'];
  return entries.map((entry) => {
    const parts = [
      formatDateTime(entry.timestamp),
      `${entry.sender} -> ${entry.recipient}`,
      entry.subject ? `Subject: ${entry.subject}` : null,
      `Preview: ${entry.preview}`,
      `Source: ${entry.source}${entry.contentStored ? '' : ' (content not stored)'}`,
    ].filter(Boolean);
    return parts.join(' | ');
  });
}

async function buildEvidenceSummary(supabase, stripe, { disputeId, bookingId }) {
  let dispute = null;
  let resolvedBookingId = bookingId || null;

  if (disputeId) {
    const { data, error } = await supabase.from('stripe_disputes').select('*').eq('id', disputeId).maybeSingle();
    if (error) throw error;
    if (!data?.id) {
      const err = new Error('Dispute not found.');
      err.statusCode = 404;
      throw err;
    }
    dispute = data;
    resolvedBookingId = dispute.booking_id || resolvedBookingId;
  }

  if (!resolvedBookingId) {
    const err = new Error('No booking linked to this dispute.');
    err.statusCode = 400;
    throw err;
  }

  const booking = await loadBookingEvidenceContext(supabase, resolvedBookingId);
  if (!booking) {
    const err = new Error('Booking not found.');
    err.statusCode = 404;
    throw err;
  }

  const customer = Array.isArray(booking.customers) ? booking.customers[0] : booking.customers;
  const boat = Array.isArray(booking.boats) ? booking.boats[0] : booking.boats;
  const waiver = Array.isArray(booking.waivers) ? booking.waivers[0] : booking.waivers;

  const [{ data: notes }, timeline, receiptUrl] = await Promise.all([
    dispute?.id
      ? supabase
          .from('dispute_notes')
          .select('note_text, created_at, admin_id')
          .eq('dispute_id', dispute.id)
          .order('created_at', { ascending: true })
      : Promise.resolve({ data: [] }),
    buildCommunicationTimeline(supabase, resolvedBookingId, booking),
    fetchReceiptUrl(stripe, booking.stripe_charge_id || dispute?.stripe_charge_id),
  ]);

  const noteLines =
    Array.isArray(notes) && notes.length > 0
      ? notes.map((note) => `${formatDateTime(note.created_at)}: ${note.note_text}`)
      : ['No admin dispute notes recorded.'];

  const sections = {
    header: [
      'LAUNCH ZONE CHARTERS — STRIPE DISPUTE EVIDENCE SUMMARY',
      `Generated: ${formatDateTime(new Date().toISOString())}`,
      dispute
        ? `Stripe dispute: ${dispute.stripe_dispute_id} (${String(dispute.status || '').replace(/_/g, ' ')})`
        : 'Booking evidence summary',
      dispute?.evidence_due_by ? `Evidence due: ${formatDateTime(dispute.evidence_due_by)}` : null,
      `Booking ID: ${resolvedBookingId}`,
    ].filter(Boolean),
    servicePurchased: serviceLines(booking, customer, boat),
    bookingTimeline: formatTimelineForSummary(
      timeline.filter((entry) => ['booking_record', 'booking_activity_events'].includes(entry.source))
    ),
    payment: paymentLines(booking, dispute, receiptUrl),
    customerAgreement: agreementLines(booking, waiver),
    communicationTimeline: formatTimelineForSummary(timeline),
    uploadedDocuments: documentLines(booking, customer),
    refundPolicy: [formatRefundPolicyText()],
    reasonChargeIsValid: reasonChargeValidLines(booking, dispute),
    adminNotes: noteLines,
    requestedOutcome: [
      'We respectfully request that this dispute be resolved in favor of Launch Zone Charters based on the verified booking, payment, customer agreement, and communication records above.',
      'All statements in this summary are derived from records stored in Launch Zone Charters systems at the time of generation.',
    ],
  };

  const summary = [
    sections.header.join('\n'),
    '',
    section('SERVICE PURCHASED', sections.servicePurchased),
    section('BOOKING TIMELINE', sections.bookingTimeline),
    section('PAYMENT', sections.payment),
    section('CUSTOMER AGREEMENT', sections.customerAgreement),
    section('COMMUNICATION TIMELINE', sections.communicationTimeline),
    section('UPLOADED DOCUMENTS', sections.uploadedDocuments),
    section('REFUND POLICY', sections.refundPolicy),
    section('REASON CHARGE IS VALID', sections.reasonChargeIsValid),
    section('ADMIN NOTES', sections.adminNotes),
    section('REQUESTED OUTCOME', sections.requestedOutcome),
  ].join('\n');

  return {
    summary,
    sections,
    timeline,
    bookingId: resolvedBookingId,
    disputeId: dispute?.id || null,
    receiptUrl,
  };
}

module.exports = {
  buildCommunicationTimeline,
  buildEvidenceSummary,
  fetchReceiptUrl,
  loadBookingEvidenceContext,
};
