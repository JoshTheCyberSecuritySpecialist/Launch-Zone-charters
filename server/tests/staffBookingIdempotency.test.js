const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseStaffIdempotencyKey,
  isStaffIdempotencyUniqueViolation,
} = require('../lib/staffBookingIdempotency');

test('parseStaffIdempotencyKey accepts valid UUID', () => {
  const parsed = parseStaffIdempotencyKey('550e8400-e29b-41d4-a716-446655440000');
  assert.ok(parsed?.key);
  assert.equal(parsed.key, '550e8400-e29b-41d4-a716-446655440000');
});

test('parseStaffIdempotencyKey rejects invalid values', () => {
  assert.equal(parseStaffIdempotencyKey(null), null);
  assert.equal(parseStaffIdempotencyKey(''), null);
  assert.ok(parseStaffIdempotencyKey('not-a-uuid')?.error);
});

test('parseStaffIdempotencyKey normalizes casing', () => {
  const parsed = parseStaffIdempotencyKey('550E8400-E29B-41D4-A716-446655440000');
  assert.equal(parsed?.key, '550e8400-e29b-41d4-a716-446655440000');
});

test('isStaffIdempotencyUniqueViolation detects staff idempotency index conflicts', () => {
  assert.equal(
    isStaffIdempotencyUniqueViolation({
      code: '23505',
      message: 'duplicate key value violates unique constraint "idx_bookings_staff_idempotency_key"',
    }),
    true
  );
  assert.equal(isStaffIdempotencyUniqueViolation({ code: '23505', message: 'other unique' }), false);
  assert.equal(isStaffIdempotencyUniqueViolation({ code: '23503' }), false);
});
