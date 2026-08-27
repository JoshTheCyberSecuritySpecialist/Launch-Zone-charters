'use strict';

/** Unrecoverable card-processing costs: 2.9% of the original payment plus $0.30. */
const FEE_PERCENT = 2.9;
const FEE_FLAT_CENTS = 30;
const CUSTOMER_REFUND_MIN_HOURS = 48;

function toCents(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.max(0, Math.round(n * 100));
}

function centsToUsd(cents) {
  return Math.round(Number(cents) || 0) / 100;
}

function formatUsdFromCents(cents) {
  return `$${centsToUsd(cents).toFixed(2)}`;
}

function feePolicySentence() {
  return (
    `Approved customer-cancellation refunds have a payment processing and administrative fee of ${FEE_PERCENT}% of the original payment plus $${(FEE_FLAT_CENTS / 100).toFixed(2)} deducted from the refund. ` +
    'This fee covers non-refundable transaction costs associated with processing the original payment and issuing the refund. ' +
    'The fee is deducted from the refund amount and is shown before a refund is issued. ' +
    'Cancellations by Launch Zone Charters because of unsafe weather, mechanical issues, or other operator cancellations are not subject to this fee.'
  );
}

/**
 * @param {{ amountPaidCents: number, alreadyRefundedCents?: number }} input
 */
function calculateCustomerCancellationRefund({ amountPaidCents, alreadyRefundedCents = 0 }) {
  const paid = Math.max(0, Math.floor(Number(amountPaidCents) || 0));
  const refunded = Math.max(0, Math.floor(Number(alreadyRefundedCents) || 0));
  const remaining = Math.max(0, paid - refunded);
  const rawFee = paid > 0 ? Math.round(paid * (FEE_PERCENT / 100)) + FEE_FLAT_CENTS : 0;
  const feeCents = Math.min(rawFee, remaining);
  const netRefundCents = Math.max(0, remaining - feeCents);
  return {
    amountPaidCents: paid,
    alreadyRefundedCents: refunded,
    remainingCents: remaining,
    feeCents,
    netRefundCents,
    canRefund: remaining > 0,
    wouldOverRefund: refunded > paid,
  };
}

function calculateOperatorCancellationRefund({ amountPaidCents, alreadyRefundedCents = 0 }) {
  const paid = Math.max(0, Math.floor(Number(amountPaidCents) || 0));
  const refunded = Math.max(0, Math.floor(Number(alreadyRefundedCents) || 0));
  const remaining = Math.max(0, paid - refunded);
  return {
    amountPaidCents: paid,
    alreadyRefundedCents: refunded,
    remainingCents: remaining,
    feeCents: 0,
    netRefundCents: remaining,
    canRefund: remaining > 0,
    wouldOverRefund: refunded > paid,
  };
}

function hoursUntilStart(startTime, now = new Date()) {
  const start = new Date(startTime).getTime();
  const current = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(current)) return null;
  return (start - current) / (60 * 60 * 1000);
}

function customerRefundWindowOpen(startTime, now = new Date()) {
  const hours = hoursUntilStart(startTime, now);
  if (hours == null) return false;
  return hours >= CUSTOMER_REFUND_MIN_HOURS;
}

module.exports = {
  FEE_PERCENT,
  FEE_FLAT_CENTS,
  CUSTOMER_REFUND_MIN_HOURS,
  toCents,
  centsToUsd,
  formatUsdFromCents,
  feePolicySentence,
  calculateCustomerCancellationRefund,
  calculateOperatorCancellationRefund,
  hoursUntilStart,
  customerRefundWindowOpen,
};
