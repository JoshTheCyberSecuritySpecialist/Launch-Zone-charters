const crypto = require('crypto');

function nowIso() {
  return new Date().toISOString();
}

function roundMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function amountFromCents(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return roundMoney(n / 100);
}

function jsonForDb(value) {
  if (value == null) return {};
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return {};
  }
}

function safeText(value, max = 1000) {
  const s = String(value || '').trim();
  return s.length > max ? `${s.slice(0, max)}...` : s;
}

function uuidOrNull(value) {
  const s = String(value || '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
    ? s
    : null;
}

function backoffNextRetry(retryCount) {
  const count = Math.max(0, Number(retryCount) || 0);
  const minutes = Math.min(12 * 60, Math.pow(2, count) * 5);
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function extractPaymentIntentId(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  return value.id || null;
}

function extractChargeId(paymentIntent) {
  if (!paymentIntent || typeof paymentIntent === 'string') return null;
  const latestCharge = paymentIntent.latest_charge;
  if (typeof latestCharge === 'string') return latestCharge;
  if (latestCharge?.id) return latestCharge.id;
  const charges = paymentIntent.charges?.data;
  if (Array.isArray(charges) && charges[0]?.id) return charges[0].id;
  return null;
}

function extractSessionIds(session) {
  if (!session) return {};
  const paymentIntentId = extractPaymentIntentId(session.payment_intent);
  const chargeId = extractChargeId(session.payment_intent);
  return {
    checkoutSessionId: session.id || null,
    paymentIntentId,
    chargeId,
  };
}

function extractEventIds(event) {
  const obj = event?.data?.object || {};
  if (event?.type?.startsWith('checkout.session.')) {
    const ids = extractSessionIds(obj);
    return {
      ...ids,
      amount: amountFromCents(obj.amount_total),
      currency: obj.currency || 'usd',
      customerEmail: obj.customer_details?.email || obj.customer_email || null,
      customerName: obj.customer_details?.name || null,
      customerPhone: obj.customer_details?.phone || null,
    };
  }
  if (event?.type?.startsWith('payment_intent.')) {
    return {
      checkoutSessionId: null,
      paymentIntentId: obj.id || null,
      chargeId: extractChargeId(obj),
      amount: amountFromCents(obj.amount_received ?? obj.amount),
      currency: obj.currency || 'usd',
      customerEmail: obj.receipt_email || null,
    };
  }
  if (event?.type === 'charge.refunded') {
    return {
      checkoutSessionId: null,
      paymentIntentId: extractPaymentIntentId(obj.payment_intent),
      chargeId: obj.id || null,
      amount: amountFromCents(obj.amount_refunded ?? obj.amount),
      currency: obj.currency || 'usd',
      customerEmail: obj.billing_details?.email || obj.receipt_email || null,
      customerName: obj.billing_details?.name || null,
      customerPhone: obj.billing_details?.phone || null,
    };
  }
  if (event?.type?.startsWith('refund.')) {
    return {
      checkoutSessionId: null,
      paymentIntentId: extractPaymentIntentId(obj.payment_intent),
      chargeId: typeof obj.charge === 'string' ? obj.charge : obj.charge?.id || null,
      amount: amountFromCents(obj.amount),
      currency: obj.currency || 'usd',
    };
  }
  if (event?.type?.startsWith('charge.dispute.')) {
    return {
      checkoutSessionId: null,
      paymentIntentId: extractPaymentIntentId(obj.payment_intent),
      chargeId: typeof obj.charge === 'string' ? obj.charge : obj.charge?.id || null,
      amount: amountFromCents(obj.amount),
      currency: obj.currency || 'usd',
      disputeId: obj.id || null,
    };
  }
  return {};
}

async function insertActivity(supabase, event) {
  if (!supabase || !event?.event_type) return null;
  const payload = {
    booking_id: event.booking_id || null,
    draft_id: event.draft_id || null,
    checkout_session_id: event.checkout_session_id || null,
    payment_intent_id: event.payment_intent_id || null,
    event_type: safeText(event.event_type, 120),
    actor_type: event.actor_type || 'system',
    actor_id: event.actor_id || null,
    message: event.message ? safeText(event.message, 1000) : null,
    payload: jsonForDb(event.payload || {}),
  };
  const { data, error } = await supabase
    .from('booking_activity_events')
    .insert(payload)
    .select('id')
    .single();
  if (error) {
    console.warn('[booking-activity]', error.message);
    return null;
  }
  return data;
}

async function recordWebhookEvent(supabase, event) {
  const ids = extractEventIds(event);
  const row = {
    event_id: String(event.id),
    event_type: String(event.type || 'unknown'),
    checkout_session_id: ids.checkoutSessionId || null,
    payment_intent_id: ids.paymentIntentId || null,
    charge_id: ids.chargeId || null,
    processing_status: 'received',
    payload: jsonForDb(event),
    received_at: nowIso(),
    updated_at: nowIso(),
  };
  const { data, error } = await supabase
    .from('stripe_webhook_events')
    .insert(row)
    .select('*')
    .single();
  if (error) {
    if (error.code === '23505') {
      const existing = await supabase
        .from('stripe_webhook_events')
        .select('*')
        .eq('event_id', row.event_id)
        .maybeSingle();
      if (!existing.error && existing.data) {
        return { data: existing.data, error: null, ids, duplicate: true };
      }
    }
    console.error('[stripe-webhook-events] upsert:', error.message);
    return { data: null, error, ids };
  }
  return { data, error: null, ids, duplicate: false };
}

async function updateWebhookEventStatus(supabase, eventId, status, fields = {}) {
  if (!eventId) return;
  const update = {
    processing_status: status,
    updated_at: nowIso(),
    ...fields,
  };
  if (status === 'processed' || status === 'ignored' || status === 'failed' || status === 'queued') {
    update.processed_at = update.processed_at || nowIso();
  }
  const { error } = await supabase.from('stripe_webhook_events').update(update).eq('event_id', eventId);
  if (error) console.warn('[stripe-webhook-events] status:', error.message);
}

function recoveryPayloadFromSession(session, extras = {}) {
  const ids = extractSessionIds(session);
  const payload = session?.metadata || {};
  return {
    payment_intent_id: extras.payment_intent_id || ids.paymentIntentId || null,
    checkout_session_id: extras.checkout_session_id || ids.checkoutSessionId || null,
    stripe_event_id: extras.stripe_event_id || null,
    booking_id: extras.booking_id || null,
    customer_name: extras.customer_name || session?.customer_details?.name || null,
    customer_email: extras.customer_email || session?.customer_details?.email || session?.customer_email || null,
    customer_phone: extras.customer_phone || session?.customer_details?.phone || null,
    boat_id: uuidOrNull(extras.boat_id || payload.boat_id),
    trip_type: extras.trip_type || payload.booking_mode || payload.booking_type || null,
    start_time: extras.start_time || payload.start_time || null,
    end_time: extras.end_time || payload.end_time || null,
    amount: extras.amount ?? amountFromCents(session?.amount_total),
    currency: extras.currency || session?.currency || 'usd',
  };
}

async function enqueueRecovery(supabase, input) {
  const retryCount = Math.max(0, Number(input.retry_count) || 0);
  const row = {
    payment_intent_id: input.payment_intent_id || null,
    checkout_session_id: input.checkout_session_id || null,
    stripe_event_id: input.stripe_event_id || null,
    booking_id: input.booking_id || null,
    customer_name: input.customer_name || null,
    customer_email: input.customer_email || null,
    customer_phone: input.customer_phone || null,
    boat_id: uuidOrNull(input.boat_id),
    trip_type: input.trip_type || null,
    start_time: input.start_time || null,
    end_time: input.end_time || null,
    amount: input.amount ?? null,
    currency: input.currency || 'usd',
    status: input.status || 'open',
    reason: input.reason || 'booking_failed',
    error: safeText(input.error || '', 4000) || null,
    retry_count: retryCount,
    next_retry_at: input.next_retry_at || backoffNextRetry(retryCount),
    updated_at: nowIso(),
  };

  const conflict = row.checkout_session_id
    ? 'checkout_session_id'
    : row.payment_intent_id
      ? 'payment_intent_id'
      : null;

  let query = supabase.from('payment_recovery_queue');
  let result;
  if (conflict) {
    result = await query.upsert(row, { onConflict: conflict }).select('*').single();
  } else {
    result = await query.insert(row).select('*').single();
  }
  if (result.error) {
    console.error('[payment-recovery] enqueue:', result.error.message);
    return { data: null, error: result.error };
  }
  return { data: result.data, error: null };
}

async function resolveRecovery(supabase, filter, fields = {}) {
  const update = {
    status: fields.status || 'resolved',
    booking_id: fields.booking_id || null,
    resolved_at: nowIso(),
    error: fields.error || null,
    updated_at: nowIso(),
  };
  let q = supabase.from('payment_recovery_queue').update(update);
  if (filter.checkout_session_id) q = q.eq('checkout_session_id', filter.checkout_session_id);
  else if (filter.payment_intent_id) q = q.eq('payment_intent_id', filter.payment_intent_id);
  else if (filter.id) q = q.eq('id', filter.id);
  else return;
  const { error } = await q.in('status', ['open', 'retrying']);
  if (error) console.warn('[payment-recovery] resolve:', error.message);
}

async function upsertBookingPayment(supabase, input) {
  const row = {
    booking_id: input.booking_id || null,
    checkout_session_id: input.checkout_session_id || null,
    payment_intent_id: input.payment_intent_id || null,
    charge_id: input.charge_id || null,
    amount: input.amount ?? 0,
    currency: input.currency || 'usd',
    status: input.status || 'received',
    payload: jsonForDb(input.payload || {}),
    updated_at: nowIso(),
  };
  const conflict = row.payment_intent_id ? 'payment_intent_id' : row.checkout_session_id ? 'checkout_session_id' : null;
  const op = conflict
    ? supabase.from('booking_payments').upsert(row, { onConflict: conflict })
    : supabase.from('booking_payments').insert(row);
  const { error } = await op;
  if (error) console.warn('[booking-payments] upsert:', error.message);
}

async function findCheckoutSessionForPaymentIntent(stripe, paymentIntentId) {
  if (!stripe || !paymentIntentId) return null;
  const sessions = await stripe.checkout.sessions.list({ payment_intent: paymentIntentId, limit: 1 });
  return sessions?.data?.[0] || null;
}

async function createOrUpdateBookingDraft(supabase, input) {
  const token = input.resume_token || crypto.randomBytes(24).toString('hex');
  const row = {
    resume_token: token,
    customer_email: input.customer_email || null,
    customer_name: input.customer_name || null,
    customer_phone: input.customer_phone || null,
    booking_payload: jsonForDb(input.booking_payload || {}),
    status: input.status || 'started',
    checkout_session_id: input.checkout_session_id || null,
    payment_intent_id: input.payment_intent_id || null,
    amount_due: input.amount_due ?? null,
    currency: input.currency || 'usd',
    expires_at: input.expires_at || null,
    booking_id: input.booking_id || null,
    updated_at: nowIso(),
  };
  const { data, error } = await supabase
    .from('booking_drafts')
    .upsert(row, { onConflict: row.checkout_session_id ? 'checkout_session_id' : 'resume_token' })
    .select('*')
    .single();
  if (error) {
    console.warn('[booking-drafts] upsert:', error.message);
    return { data: null, error };
  }
  return { data, error: null };
}

async function runAbandonedCheckoutReminders({ supabase, resend, resendFrom, publicBase }) {
  if (!supabase || !resend) return { scanned: 0, sent: 0, skipped: 'not_configured' };
  const now = new Date();
  const cutoff = new Date(now.getTime() - 30 * 60 * 1000).toISOString();
  const { data: drafts, error } = await supabase
    .from('booking_drafts')
    .select('id, resume_token, customer_email, customer_name, checkout_session_id, reminder_count, last_reminder_sent_at, created_at, booking_id')
    .eq('status', 'checkout_created')
    .is('booking_id', null)
    .lt('created_at', cutoff)
    .lt('reminder_count', 3)
    .order('created_at', { ascending: true })
    .limit(50);
  if (error) throw error;
  let sent = 0;
  for (const draft of drafts || []) {
    const count = Number(draft.reminder_count || 0);
    const last = draft.last_reminder_sent_at ? new Date(draft.last_reminder_sent_at).getTime() : 0;
    const minAgeMs = count === 0 ? 30 * 60 * 1000 : count === 1 ? 24 * 60 * 60 * 1000 : 48 * 60 * 60 * 1000;
    const basis = last || new Date(draft.created_at).getTime();
    if (Date.now() - basis < minAgeMs) continue;
    const email = String(draft.customer_email || '').trim().toLowerCase();
    if (!email) continue;
    const resumeUrl = `${String(publicBase || '').replace(/\/$/, '')}/booking?resume=${encodeURIComponent(draft.resume_token)}`;
    const result = await resend.emails.send({
      from: resendFrom,
      to: email,
      subject: count === 0 ? 'Continue your Launch Zone booking' : 'Still want to finish your Launch Zone booking?',
      html: `
        <p>We saved your Launch Zone booking progress.</p>
        <p><a href="${resumeUrl}">Continue your booking</a></p>
        <p>If you already completed payment, call <a href="tel:803-542-1761">803-542-1761</a> and we will reconcile it immediately.</p>
      `,
    });
    if (result.error) {
      await enqueueRecovery(supabase, {
        checkout_session_id: draft.checkout_session_id,
        customer_email: email,
        reason: 'email_failed',
        error: result.error.message || 'Abandoned checkout email failed',
      });
      continue;
    }
    sent += 1;
    await supabase
      .from('booking_drafts')
      .update({
        reminder_count: count + 1,
        last_reminder_sent_at: nowIso(),
        updated_at: nowIso(),
      })
      .eq('id', draft.id);
  }
  return { scanned: (drafts || []).length, sent };
}

module.exports = {
  amountFromCents,
  backoffNextRetry,
  createOrUpdateBookingDraft,
  enqueueRecovery,
  extractEventIds,
  extractPaymentIntentId,
  extractSessionIds,
  findCheckoutSessionForPaymentIntent,
  insertActivity,
  jsonForDb,
  recordWebhookEvent,
  recoveryPayloadFromSession,
  resolveRecovery,
  runAbandonedCheckoutReminders,
  safeText,
  updateWebhookEventStatus,
  upsertBookingPayment,
};
