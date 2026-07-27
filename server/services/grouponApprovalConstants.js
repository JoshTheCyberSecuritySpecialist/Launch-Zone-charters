const APPROVABLE_STATUSES = new Set(['pending_verification', 'pending']);

const REJECT_REASONS = new Set([
  'requested_time_unavailable',
  'boat_unavailable',
  'captain_unavailable',
  'capacity_exceeded',
  'weight_limit_exceeded',
  'voucher_issue',
  'duplicate_request',
  'customer_cancelled',
  'other',
]);

function isGrouponPendingBooking(booking) {
  if (!booking) return false;
  if (String(booking.booking_source || '') !== 'groupon') return false;
  return APPROVABLE_STATUSES.has(String(booking.status || ''));
}

module.exports = {
  APPROVABLE_STATUSES,
  REJECT_REASONS,
  isGrouponPendingBooking,
};
