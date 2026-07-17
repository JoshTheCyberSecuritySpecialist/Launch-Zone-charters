const assert = require('node:assert/strict');
const test = require('node:test');
const preTripApprovalService = require('../services/preTripApprovalService');

test('buildBookingUpdatesFromSubmission omits updated_at and skips unchanged fields', () => {
  const submission = {
    license_url: 'https://example.com/license.jpg',
    insurance_url: 'https://example.com/insurance.jpg',
    insurance_status: 'submitted',
    waiver_signed: true,
    waiver_signed_at: '2026-07-16T12:00:00.000Z',
  };
  const booking = {
    waiver_signed: false,
    license_url: null,
    insurance_url: null,
  };

  const updates = preTripApprovalService.buildBookingUpdatesFromSubmission(submission, booking, {
    verifyLicense: true,
  });

  assert.equal('updated_at' in updates, false);
  assert.equal(updates.license_url, submission.license_url);
  assert.equal(updates.license_status, 'verified');
  assert.equal(updates.insurance_status, 'submitted');
  assert.equal(updates.waiver_signed, true);
  assert.equal(updates.waiver_signed_at, submission.waiver_signed_at);
});

test('buildBookingUpdatesFromSubmission returns empty when nothing to copy', () => {
  const updates = preTripApprovalService.buildBookingUpdatesFromSubmission(
    { waiver_signed: false },
    { waiver_signed: true, license_url: 'x', insurance_url: 'y' },
    { verifyLicense: true }
  );
  assert.deepEqual(updates, {});
});

test('buildBookingUpdatesFromSubmission does not overwrite existing license on match', () => {
  const updates = preTripApprovalService.buildBookingUpdatesFromSubmission(
    { license_url: 'https://example.com/new.jpg' },
    { license_url: 'https://example.com/existing.jpg' },
    { verifyLicense: false }
  );
  assert.equal('license_url' in updates, false);
  assert.equal('license_status' in updates, false);
});
