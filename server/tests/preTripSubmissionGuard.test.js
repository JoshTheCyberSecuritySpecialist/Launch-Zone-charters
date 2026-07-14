const assert = require('assert');
const guard = require('../services/preTripSubmissionGuard');

function run() {
  assert.strictEqual(guard.normalizeEmail('  Pat@Example.COM '), 'pat@example.com');
  assert.strictEqual(guard.normalizePhoneDigits('(803) 542-1761'), '8035421761');
  assert.strictEqual(guard.phoneLast10('+1 (803) 542-1761'), '8035421761');
  assert.strictEqual(guard.phoneDigitsMatch('803-542-1761', '(803) 542-1761'), true);
  assert.strictEqual(guard.phoneDigitsMatch('18035421761', '8035421761'), true);
  assert.strictEqual(guard.phoneDigitsMatch('8035421761', '9999999999'), false);

  const key = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  assert.strictEqual(guard.normalizeIdempotencyKey(key), key);
  assert.strictEqual(guard.normalizeIdempotencyKey('not-a-uuid'), null);

  const rows = [
    {
      id: 'sub-old',
      email: 'guest@example.com',
      phone: '8035421761',
      admin_status: 'pending',
      idempotency_key: null,
      created_at: '2026-07-01T00:00:00.000Z',
    },
    {
      id: 'sub-key',
      email: 'guest@example.com',
      phone: '8035421761',
      admin_status: 'pending',
      idempotency_key: key,
      created_at: '2026-07-02T00:00:00.000Z',
    },
  ];

  const byKey = guard.pickReusableSubmission(rows, {
    email: 'GUEST@example.com',
    phone: '(803) 542-1761',
    idempotencyKey: key,
  });
  assert.strictEqual(byKey.reason, 'idempotency_key');
  assert.strictEqual(byKey.reuse.id, 'sub-key');

  // Email-only / empty phone must never reuse (IDOR hardening).
  const emptyPhone = guard.pickReusableSubmission(rows, {
    email: 'guest@example.com',
    phone: '',
    idempotencyKey: null,
  });
  assert.strictEqual(emptyPhone.reuse, null);

  const emptyPhoneWithKey = guard.pickReusableSubmission(rows, {
    email: 'guest@example.com',
    phone: '',
    idempotencyKey: key,
  });
  assert.strictEqual(emptyPhoneWithKey.reuse, null);

  // Idempotency key alone is not enough without matching phone.
  const wrongPhoneKey = guard.pickReusableSubmission(rows, {
    email: 'guest@example.com',
    phone: '9999999999',
    idempotencyKey: key,
  });
  assert.strictEqual(wrongPhoneKey.reuse, null);

  const byContact = guard.pickReusableSubmission(rows, {
    email: 'guest@example.com',
    phone: '803-542-1761',
    idempotencyKey: null,
  });
  assert.strictEqual(byContact.reason, 'email_phone_match');
  assert.ok(byContact.reuse);
  assert.strictEqual(guard.isDuplicatePrevention(byContact.reason), true);

  const rejectedOnly = guard.pickReusableSubmission(
    [
      {
        id: 'sub-rej',
        email: 'guest@example.com',
        phone: '8035421761',
        admin_status: 'rejected',
        idempotency_key: null,
        created_at: '2026-07-03T00:00:00.000Z',
      },
    ],
    { email: 'guest@example.com', phone: '8035421761', idempotencyKey: null }
  );
  assert.strictEqual(rejectedOnly.reuse, null);

  const noMatch = guard.pickReusableSubmission(rows, {
    email: 'other@example.com',
    phone: '8035421761',
    idempotencyKey: null,
  });
  assert.strictEqual(noMatch.reuse, null);

  console.log('preTripSubmissionGuard.test: all assertions passed');
}

run();
