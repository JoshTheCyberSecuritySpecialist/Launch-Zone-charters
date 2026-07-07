const bookingReliability = require('./bookingReliability');

const OPEN_STATUSES = new Set([
  'warning_needs_response',
  'warning_under_review',
  'needs_response',
  'under_review',
]);

const NEEDS_RESPONSE_STATUSES = new Set(['warning_needs_response', 'needs_response']);

function nowIso() {
  return new Date().toISOString();
}

function safeText(value, max = 500) {
  const s = String(value || '').trim();
  return s.length > max ? `${s.slice(0, max)}...` : s;
}

function roundMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function normalizeStripeStatus(status) {
  const s = String(status || '').trim().toLowerCase();
  const allowed = [
    'warning_needs_response',
    'warning_under_review',
    'warning_closed',
    'needs_response',
    'under_review',
    'charge_refunded',
    'won',
    'lost',
  ];
  return allowed.includes(s) ? s : 'needs_response';
}

function normalizeOutcome(dispute) {
  const status = normalizeStripeStatus(dispute?.status);
  if (status === 'won') return 'won';
  if (status === 'lost') return 'lost';
  if (status === 'charge_refunded') return 'charge_refunded';
  if (status === 'warning_closed') return 'warning_closed';
  return null;
}

function extractChargeId(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  return value.id || null;
}

function extractPaymentIntentId(value) {
  return bookingReliability.extractPaymentIntentId(value);
}

function disputeDueBy(dispute) {
  const due = dispute?.evidence_details?.due_by;
  if (!due) return null;
  const d = new Date(Number(due) * 1000);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

async function linkDisputeToRecords(supabase, { chargeId, paymentIntentId }) {
  const charge = safeText(chargeId, 120) || null;
  const paymentIntent = safeText(paymentIntentId, 120) || null;
  if (!charge && !paymentIntent) {
    return { bookingId: null, shopOrderId: null, checkoutSessionId: null };
  }

  const orParts = [];
  if (charge) orParts.push(`stripe_charge_id.eq.${charge}`);
  if (paymentIntent) orParts.push(`payment_intent_id.eq.${paymentIntent}`);

  const { data: booking } = await supabase
    .from('bookings')
    .select('id, checkout_session_id, stripe_payment_id')
    .or(orParts.join(','))
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (booking?.id) {
    return {
      bookingId: booking.id,
      shopOrderId: null,
      checkoutSessionId: booking.checkout_session_id || booking.stripe_payment_id || null,
    };
  }

  const paymentOrParts = [];
  if (charge) paymentOrParts.push(`charge_id.eq.${charge}`);
  if (paymentIntent) paymentOrParts.push(`payment_intent_id.eq.${paymentIntent}`);
  const { data: paymentRow } = await supabase
    .from('booking_payments')
    .select('booking_id, checkout_session_id')
    .or(paymentOrParts.join(','))
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (paymentRow?.booking_id) {
    return {
      bookingId: paymentRow.booking_id,
      shopOrderId: null,
      checkoutSessionId: paymentRow.checkout_session_id || null,
    };
  }

  const { data: shopOrder } = await supabase
    .from('shop_orders')
    .select('id, stripe_session_id')
    .or(orParts.join(','))
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (shopOrder?.id) {
    return {
      bookingId: null,
      shopOrderId: shopOrder.id,
      checkoutSessionId: shopOrder.stripe_session_id || null,
    };
  }

  return { bookingId: null, shopOrderId: null, checkoutSessionId: null };
}

function disputeRowFromStripe(dispute, links = {}) {
  const chargeId = extractChargeId(dispute.charge);
  const paymentIntentId = extractPaymentIntentId(dispute.payment_intent);
  const status = normalizeStripeStatus(dispute.status);
  return {
    stripe_dispute_id: safeText(dispute.id, 120),
    stripe_charge_id: chargeId,
    payment_intent_id: paymentIntentId,
    checkout_session_id: links.checkoutSessionId || null,
    booking_id: links.bookingId || null,
    shop_order_id: links.shopOrderId || null,
    amount: roundMoney(bookingReliability.amountFromCents(dispute.amount) ?? 0),
    currency: safeText(dispute.currency, 12) || 'usd',
    reason: safeText(dispute.reason, 120) || null,
    status,
    outcome: normalizeOutcome(dispute),
    evidence_due_by: disputeDueBy(dispute),
    stripe_payload: bookingReliability.jsonForDb(dispute),
    updated_at: nowIso(),
  };
}

async function upsertDisputeFromStripe(supabase, dispute) {
  const chargeId = extractChargeId(dispute.charge);
  const paymentIntentId = extractPaymentIntentId(dispute.payment_intent);
  const links = await linkDisputeToRecords(supabase, { chargeId, paymentIntentId });
  const row = disputeRowFromStripe(dispute, links);

  const { data: existing } = await supabase
    .from('stripe_disputes')
    .select('id, booking_id, shop_order_id')
    .eq('stripe_dispute_id', row.stripe_dispute_id)
    .maybeSingle();

  if (existing?.id) {
    if (!row.booking_id && existing.booking_id) row.booking_id = existing.booking_id;
    if (!row.shop_order_id && existing.shop_order_id) row.shop_order_id = existing.shop_order_id;
    const { data, error } = await supabase
      .from('stripe_disputes')
      .update(row)
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error) throw error;
    return { dispute: data, created: false, bookingId: data.booking_id, shopOrderId: data.shop_order_id };
  }

  const { data, error } = await supabase.from('stripe_disputes').insert(row).select('*').single();
  if (error) throw error;
  return { dispute: data, created: true, bookingId: data.booking_id, shopOrderId: data.shop_order_id };
}

async function loadDisputeDetail(supabase, disputeId) {
  const { data: dispute, error } = await supabase
    .from('stripe_disputes')
    .select('*')
    .eq('id', disputeId)
    .maybeSingle();
  if (error) throw error;
  if (!dispute?.id) return null;

  const queries = [
    supabase
      .from('dispute_notes')
      .select('id, admin_id, note_text, created_at')
      .eq('dispute_id', dispute.id)
      .order('created_at', { ascending: false }),
  ];

  if (dispute.booking_id) {
    queries.push(
      supabase
        .from('bookings')
        .select(
          'id, start_time, end_time, status, payment_status, deposit_paid, balance_due, total_price, payment_intent_id, checkout_session_id, stripe_charge_id, stripe_payment_id, rental_location, guest_count, created_at, customers(full_name, email, phone), boats(name, type)'
        )
        .eq('id', dispute.booking_id)
        .maybeSingle()
    );
  } else {
    queries.push(Promise.resolve({ data: null, error: null }));
  }

  const [{ data: notes, error: notesError }, { data: booking, error: bookingError }] = await Promise.all(queries);
  if (notesError) throw notesError;
  if (bookingError) throw bookingError;

  return {
    dispute,
    notes: Array.isArray(notes) ? notes : [],
    booking: booking || null,
  };
}

async function listDisputes(supabase, filters = {}) {
  const limit = Math.min(Math.max(Number(filters.limit) || 100, 1), 250);
  let query = supabase
    .from('stripe_disputes')
    .select(
      'id, stripe_dispute_id, stripe_charge_id, payment_intent_id, checkout_session_id, booking_id, shop_order_id, amount, currency, reason, status, outcome, evidence_due_by, created_at, updated_at, bookings(id, start_time, customers(full_name, email, phone))'
    )
    .order('evidence_due_by', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(limit);

  const statusFilter = safeText(filters.status, 40).toLowerCase();
  if (statusFilter === 'open') {
    query = query.in('status', Array.from(OPEN_STATUSES));
  } else if (statusFilter === 'needs_response') {
    query = query.in('status', Array.from(NEEDS_RESPONSE_STATUSES));
  } else if (statusFilter === 'won') {
    query = query.eq('status', 'won');
  } else if (statusFilter === 'lost') {
    query = query.in('status', ['lost', 'charge_refunded']);
  } else if (statusFilter) {
    query = query.eq('status', statusFilter);
  }

  const { data, error } = await query;
  if (error) throw error;

  let rows = Array.isArray(data) ? data : [];
  const search = safeText(filters.search, 200).toLowerCase();
  if (search) {
    rows = rows.filter((row) => {
      const customer = row.bookings?.customers;
      const haystack = [
        row.stripe_dispute_id,
        row.stripe_charge_id,
        row.payment_intent_id,
        row.checkout_session_id,
        row.booking_id,
        row.reason,
        customer?.full_name,
        customer?.email,
        customer?.phone,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(search);
    });
  }

  return rows;
}

async function getDisputeSummary(supabase) {
  const { data, error } = await supabase
    .from('stripe_disputes')
    .select('id, status, evidence_due_by');
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  const now = Date.now();
  const in72h = now + 72 * 60 * 60 * 1000;

  return {
    open: rows.filter((row) => OPEN_STATUSES.has(String(row.status || ''))).length,
    needsResponse: rows.filter((row) => NEEDS_RESPONSE_STATUSES.has(String(row.status || ''))).length,
    won: rows.filter((row) => String(row.status || '') === 'won').length,
    lost: rows.filter((row) => ['lost', 'charge_refunded'].includes(String(row.status || ''))).length,
    deadlineSoon: rows.filter((row) => {
      if (!NEEDS_RESPONSE_STATUSES.has(String(row.status || ''))) return false;
      if (!row.evidence_due_by) return false;
      const due = new Date(row.evidence_due_by).getTime();
      return Number.isFinite(due) && due >= now && due <= in72h;
    }).length,
  };
}

async function getDisputeForBooking(supabase, bookingId) {
  const { data, error } = await supabase
    .from('stripe_disputes')
    .select('id, stripe_dispute_id, status, reason, amount, currency, evidence_due_by, outcome, created_at, updated_at')
    .eq('booking_id', bookingId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) return null;

  const { data: notes, error: notesError } = await supabase
    .from('dispute_notes')
    .select('id, admin_id, note_text, created_at')
    .eq('dispute_id', data.id)
    .order('created_at', { ascending: false })
    .limit(20);
  if (notesError) throw notesError;

  return { dispute: data, notes: Array.isArray(notes) ? notes : [] };
}

async function addDisputeNote(supabase, { disputeId, adminId, noteText }) {
  const text = safeText(noteText, 4000);
  if (!text) {
    const err = new Error('Note text is required.');
    err.statusCode = 400;
    throw err;
  }
  const { data, error } = await supabase
    .from('dispute_notes')
    .insert({
      dispute_id: disputeId,
      admin_id: adminId || null,
      note_text: text,
    })
    .select('id, admin_id, note_text, created_at')
    .single();
  if (error) throw error;
  return data;
}

module.exports = {
  OPEN_STATUSES,
  NEEDS_RESPONSE_STATUSES,
  addDisputeNote,
  disputeDueBy,
  getDisputeForBooking,
  getDisputeSummary,
  linkDisputeToRecords,
  listDisputes,
  loadDisputeDetail,
  normalizeStripeStatus,
  upsertDisputeFromStripe,
};
