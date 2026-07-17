/**
 * Validation helpers for admin pre-trip approve/reject actions.
 */

function normalizePreTripAction(raw) {
  const action = String(raw || '')
    .trim()
    .toLowerCase();
  if (['match', 'approve', 'reject'].includes(action)) return action;
  return null;
}

function preTripTerminalConflict(adminStatus, action) {
  const status = String(adminStatus || '')
    .trim()
    .toLowerCase();
  const act = normalizePreTripAction(action);
  if (!act) return null;

  if (status === 'approved') {
    return 'Submission is already approved.';
  }
  if (status === 'rejected') {
    if (act === 'reject') return 'Submission is already rejected.';
    return 'Submission was rejected and cannot be changed.';
  }
  return null;
}

function normalizeRejectionReason(raw, maxLen = 500) {
  const text = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return { ok: false, reason: 'Rejection reason is required.' };
  if (text.length < 3) {
    return { ok: false, reason: 'Rejection reason must be at least 3 characters.' };
  }
  return { ok: true, reason: text.slice(0, maxLen) };
}

module.exports = {
  normalizePreTripAction,
  preTripTerminalConflict,
  normalizeRejectionReason,
};
