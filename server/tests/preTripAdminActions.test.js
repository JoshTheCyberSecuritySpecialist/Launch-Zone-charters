const assert = require('node:assert/strict');
const test = require('node:test');
const preTripAdminActions = require('../services/preTripAdminActions');

test('preTripTerminalConflict blocks repeat or conflicting actions', () => {
  assert.equal(preTripAdminActions.preTripTerminalConflict('approved', 'approve'), 'Submission is already approved.');
  assert.equal(preTripAdminActions.preTripTerminalConflict('rejected', 'reject'), 'Submission is already rejected.');
  assert.equal(preTripAdminActions.preTripTerminalConflict('rejected', 'approve'), 'Submission was rejected and cannot be changed.');
  assert.equal(preTripAdminActions.preTripTerminalConflict('pending', 'approve'), null);
  assert.equal(preTripAdminActions.preTripTerminalConflict('matched', 'approve'), null);
});

test('normalizeRejectionReason requires meaningful text', () => {
  assert.equal(preTripAdminActions.normalizeRejectionReason('').ok, false);
  assert.equal(preTripAdminActions.normalizeRejectionReason('  ').ok, false);
  assert.equal(preTripAdminActions.normalizeRejectionReason('no').ok, false);
  const ok = preTripAdminActions.normalizeRejectionReason('  Missing license photo  ');
  assert.equal(ok.ok, true);
  assert.equal(ok.reason, 'Missing license photo');
});
