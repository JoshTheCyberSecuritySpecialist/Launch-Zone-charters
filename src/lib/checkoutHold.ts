/** Website Stripe checkout holds — presentation helper. Server remains authoritative. */

export type CheckoutHoldLike = {
  status?: string | null;
  payment_status?: string | null;
  booking_source?: string | null;
  staff_created?: boolean | null;
  stripe_checkout_session_id?: string | null;
  checkout_session_id?: string | null;
  stripe_payment_id?: string | null;
  payment_intent_id?: string | null;
  deposit_paid?: number | string | null;
  expires_at?: string | null;
  admin_notes?: string | null;
};

function sessionIdOf(row: CheckoutHoldLike): string {
  return String(row.stripe_checkout_session_id || row.checkout_session_id || '').trim();
}

function isPaidLike(row: CheckoutHoldLike): boolean {
  if (row.stripe_payment_id || row.payment_intent_id) return true;
  const paid = Number(row.deposit_paid ?? 0);
  if (Number.isFinite(paid) && paid > 0) return true;
  const paymentStatus = String(row.payment_status || '').toLowerCase();
  return paymentStatus === 'paid' || paymentStatus === 'deposit_paid';
}

function isProtectedSource(row: CheckoutHoldLike): boolean {
  const source = String(row.booking_source || '').trim().toLowerCase();
  if (source === 'groupon' || source === 'admin') return true;
  return Boolean(row.staff_created);
}

export function isUnpaidWebsiteCheckoutHold(row: CheckoutHoldLike): boolean {
  if (isProtectedSource(row) || isPaidLike(row) || !sessionIdOf(row)) return false;
  return String(row.status || '').toLowerCase() === 'pending';
}

export function isExpiredCheckoutHold(row: CheckoutHoldLike, now = Date.now()): boolean {
  if (!isUnpaidWebsiteCheckoutHold(row) || !row.expires_at) return false;
  const exp = new Date(row.expires_at).getTime();
  return Number.isFinite(exp) && exp < now;
}

export function shouldHideCheckoutHoldFromCalendar(row: CheckoutHoldLike, now = Date.now()): boolean {
  if (isProtectedSource(row) || isPaidLike(row) || !sessionIdOf(row)) return false;
  const status = String(row.status || '').toLowerCase();
  if (status === 'cancelled' && String(row.admin_notes || '').includes('Checkout hold')) return true;
  return isExpiredCheckoutHold(row, now);
}

export function isCalendarCheckoutHold(row: CheckoutHoldLike): boolean {
  return isUnpaidWebsiteCheckoutHold(row) && !isExpiredCheckoutHold(row);
}
