'use strict';

const calc = require('../lib/customerCancellationRefund');

const CUSTOMER_KIND = 'customer';
const OPERATOR_KIND = 'operator';

function paymentIntentIdFromBooking(booking) {
  const raw =
    booking?.payment_intent_id ||
    booking?.stripe_payment_intent_id ||
    booking?.stripe_payment_id ||
    '';
  const id = String(raw || '').trim();
  if (id.startsWith('pi_')) return id;
  return '';
}

function bookingPaidCentsFallback(booking) {
  const paid = Number(booking?.deposit_paid ?? booking?.amount_collected ?? 0);
  return calc.toCents(paid);
}

function sumSuccessfulRefunds(refundList) {
  return (refundList || [])
    .filter((row) => {
      const status = String(row?.status || '').toLowerCase();
      return status !== 'failed' && status !== 'canceled' && status !== 'cancelled';
    })
    .reduce((sum, row) => sum + Math.max(0, Math.floor(Number(row.amount) || 0)), 0);
}

async function loadStripePaymentState(stripe, paymentIntentId) {
  if (!stripe || !paymentIntentId) {
    return { amountPaidCents: 0, alreadyRefundedCents: 0, currency: 'usd', stripeAvailable: false };
  }
  const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
  const amountPaidCents = Math.max(0, Math.floor(Number(pi.amount_received || pi.amount || 0)));
  const refunds = await stripe.refunds.list({ payment_intent: paymentIntentId, limit: 100 });
  const alreadyRefundedCents = sumSuccessfulRefunds(refunds.data);
  return {
    amountPaidCents,
    alreadyRefundedCents,
    currency: String(pi.currency || 'usd').toLowerCase(),
    stripeAvailable: true,
    paymentIntentStatus: pi.status,
  };
}

function buildQuote({ kind, amountPaidCents, alreadyRefundedCents, startTime, now }) {
  const numbers =
    kind === OPERATOR_KIND
      ? calc.calculateOperatorCancellationRefund({ amountPaidCents, alreadyRefundedCents })
      : calc.calculateCustomerCancellationRefund({ amountPaidCents, alreadyRefundedCents });
  const hours = calc.hoursUntilStart(startTime, now);
  const windowOpen = calc.customerRefundWindowOpen(startTime, now);
  return {
    kind,
    ...numbers,
    hoursUntilStart: hours,
    customerWindowOpen: windowOpen,
    feePercent: calc.FEE_PERCENT,
    feeFlatCents: calc.FEE_FLAT_CENTS,
    minHours: calc.CUSTOMER_REFUND_MIN_HOURS,
    amountPaidUsd: calc.centsToUsd(numbers.amountPaidCents),
    feeUsd: calc.centsToUsd(numbers.feeCents),
    netRefundUsd: calc.centsToUsd(numbers.netRefundCents),
    alreadyRefundedUsd: calc.centsToUsd(numbers.alreadyRefundedCents),
    remainingUsd: calc.centsToUsd(numbers.remainingCents),
  };
}

function eligibilityError({ booking, kind, quote, stripeState }) {
  const source = String(booking?.booking_source || booking?.payment_method || '').toLowerCase();
  if (source === 'groupon' || String(booking?.payment_method || '').toLowerCase() === 'groupon') {
    return 'Groupon payments are not refunded in Stripe. Handle Groupon refunds through Groupon.';
  }
  if (!paymentIntentIdFromBooking(booking)) {
    return 'This booking has no Stripe PaymentIntent, so an online refund cannot be issued here.';
  }
  if (stripeState && stripeState.stripeAvailable === false) {
    return 'Stripe is not configured.';
  }
  if (quote.alreadyRefundedCents >= quote.amountPaidCents && quote.amountPaidCents > 0) {
    return 'This payment has already been fully refunded.';
  }
  if (quote.remainingCents <= 0) {
    return 'There is no remaining paid amount to refund.';
  }
  if (kind === CUSTOMER_KIND && !quote.customerWindowOpen) {
    return `Customer-cancellation refunds are only available ${calc.CUSTOMER_REFUND_MIN_HOURS}+ hours before the trip. Use an operator refund only if Launch Zone cancelled the trip.`;
  }
  if (quote.netRefundCents < 1 && kind === CUSTOMER_KIND && quote.feeCents >= quote.remainingCents) {
    return 'The processing and administrative fee equals the remaining payment, so no refund can be issued.';
  }
  if (quote.netRefundCents < 1) {
    return 'Refund amount would be zero.';
  }
  return null;
}

async function previewBookingRefund({ stripe, booking, kind = CUSTOMER_KIND, now = new Date() }) {
  const normalizedKind = kind === OPERATOR_KIND ? OPERATOR_KIND : CUSTOMER_KIND;
  const paymentIntentId = paymentIntentIdFromBooking(booking);
  let stripeState = {
    amountPaidCents: bookingPaidCentsFallback(booking),
    alreadyRefundedCents: 0,
    currency: 'usd',
    stripeAvailable: Boolean(stripe && paymentIntentId),
  };
  if (stripe && paymentIntentId) {
    stripeState = await loadStripePaymentState(stripe, paymentIntentId);
  }
  const amountPaidCents = stripeState.amountPaidCents || bookingPaidCentsFallback(booking);
  const quote = buildQuote({
    kind: normalizedKind,
    amountPaidCents,
    alreadyRefundedCents: stripeState.alreadyRefundedCents,
    startTime: booking?.start_time,
    now,
  });
  const error = eligibilityError({ booking, kind: normalizedKind, quote, stripeState });
  return {
    ok: !error,
    error,
    paymentIntentId: paymentIntentId || null,
    currency: stripeState.currency || 'usd',
    quote,
    policy: {
      feeSentence: calc.feePolicySentence(),
      customerMinHours: calc.CUSTOMER_REFUND_MIN_HOURS,
      feePercent: calc.FEE_PERCENT,
      feeFlatCents: calc.FEE_FLAT_CENTS,
    },
  };
}

async function issueBookingRefund({
  stripe,
  supabase,
  bookingReliability,
  booking,
  adminUserId,
  kind = CUSTOMER_KIND,
  now = new Date(),
}) {
  const preview = await previewBookingRefund({ stripe, booking, kind, now });
  if (!preview.ok) {
    const err = new Error(preview.error || 'Refund is not available.');
    err.statusCode = 400;
    throw err;
  }
  const paymentIntentId = preview.paymentIntentId;
  const amount = preview.quote.netRefundCents;
  const idempotencyKey = `lz-${preview.quote.kind}-refund:${booking.id}:${paymentIntentId}`.slice(0, 255);

  let refund;
  try {
    refund = await stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        amount,
        reason: 'requested_by_customer',
        metadata: {
          booking_id: String(booking.id),
          refund_kind: preview.quote.kind,
          fee_cents: String(preview.quote.feeCents),
          original_paid_cents: String(preview.quote.amountPaidCents),
        },
      },
      { idempotencyKey }
    );
  } catch (e) {
    const message = String(e?.message || e);
    if (/already been refunded|has already been refunded|charge has been refunded/i.test(message)) {
      const err = new Error('This payment has already been refunded.');
      err.statusCode = 409;
      throw err;
    }
    const err = new Error(message || 'Stripe refund failed.');
    err.statusCode = 502;
    throw err;
  }

  const refundedTotal = preview.quote.alreadyRefundedCents + amount;
  const remainingAfterRefund = Math.max(0, preview.quote.amountPaidCents - refundedTotal);
  const retainedFee = preview.quote.kind === CUSTOMER_KIND ? preview.quote.feeCents : 0;
  const fullyRefunded = remainingAfterRefund <= retainedFee;
  const paymentStatus = fullyRefunded ? 'refunded' : booking.payment_status;

  if (supabase) {
    const noteLine = `[Refund ${new Date().toISOString()}] ${preview.quote.kind} ${calc.formatUsdFromCents(amount)} to customer; fee ${calc.formatUsdFromCents(preview.quote.feeCents)}; Stripe ${refund.id}`;
    const adminNotes = [booking.admin_notes, noteLine].filter(Boolean).join('\n');
    const update = { admin_notes: adminNotes };
    if (fullyRefunded) update.payment_status = 'refunded';
    if (String(booking.status || '') !== 'cancelled') update.status = 'cancelled';
    await supabase.from('bookings').update(update).eq('id', booking.id);
    if (bookingReliability?.insertActivity) {
      await bookingReliability.insertActivity(supabase, {
        booking_id: booking.id,
        payment_intent_id: paymentIntentId,
        event_type: 'refund_issued',
        actor_type: 'admin',
        actor_id: adminUserId || null,
        message: `${preview.quote.kind === OPERATOR_KIND ? 'Operator' : 'Customer-cancellation'} refund issued.`,
        payload: {
          refund_id: refund.id,
          kind: preview.quote.kind,
          amount_paid_cents: preview.quote.amountPaidCents,
          fee_cents: preview.quote.feeCents,
          refund_cents: amount,
          already_refunded_cents: preview.quote.alreadyRefundedCents,
        },
      });
    }
  }

  return {
    ok: true,
    refundId: refund.id,
    quote: preview.quote,
    paymentStatus,
  };
}

module.exports = {
  CUSTOMER_KIND,
  OPERATOR_KIND,
  paymentIntentIdFromBooking,
  previewBookingRefund,
  issueBookingRefund,
};
