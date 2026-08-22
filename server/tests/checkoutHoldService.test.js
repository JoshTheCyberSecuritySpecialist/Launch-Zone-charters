'use strict';

const assert = require('assert');
const {
  isUnpaidWebsiteCheckoutHold,
  isExpiredCheckoutHold,
  isProtectedBookingSource,
  canSendCustomerBookingConfirmation,
  canAccessCustomerTripDocuments,
  resolveExistingCheckoutBooking,
  shouldHideFromOperationsCalendar,
  releaseUnpaidCheckoutHold,
  cleanupExpiredCheckoutHolds,
} = require('../services/checkoutHoldService');

function websiteHold(partial = {}) {
  return {
    id: partial.id || 'hold-1',
    status: 'pending',
    payment_status: 'pending',
    booking_source: null,
    staff_created: false,
    stripe_checkout_session_id: 'cs_test_hold',
    checkout_session_id: null,
    stripe_payment_id: null,
    payment_intent_id: null,
    deposit_paid: 0,
    amount_collected: 0,
    expires_at: new Date(Date.now() - 60_000).toISOString(),
    admin_notes: 'Checkout hold · expires already',
    ...partial,
  };
}

function createFakeSupabase(rows) {
  const store = rows.map((row) => ({ ...row }));
  return {
    store,
    from() {
      const filters = [];
      const api = {
        select() {
          return api;
        },
        eq(col, val) {
          filters.push((row) => row[col] === val);
          return api;
        },
        is(col, val) {
          filters.push((row) => row[col] == val);
          return api;
        },
        not(col, op) {
          if (op === 'is') filters.push((row) => row[col] != null);
          return api;
        },
        lt(col, val) {
          filters.push((row) => String(row[col] || '') < String(val));
          return api;
        },
        or() {
          return api;
        },
        async then(resolve) {
          const data = store.filter((row) => filters.every((fn) => fn(row)));
          return resolve({ data, error: null });
        },
        update(patch) {
          return {
            eq(col, val) {
              store.forEach((row, i) => {
                if (row[col] === val) store[i] = { ...row, ...patch };
              });
              return { error: null };
            },
          };
        },
      };
      return api;
    },
  };
}

function runPredicateTests() {
  assert.strictEqual(isUnpaidWebsiteCheckoutHold(websiteHold()), true);
  assert.strictEqual(isExpiredCheckoutHold(websiteHold()), true);
  assert.strictEqual(
    isExpiredCheckoutHold(websiteHold({ expires_at: new Date(Date.now() + 60_000).toISOString() })),
    false
  );

  assert.strictEqual(isProtectedBookingSource({ booking_source: 'groupon' }), true);
  assert.strictEqual(isUnpaidWebsiteCheckoutHold(websiteHold({ booking_source: 'groupon' })), false);
  assert.strictEqual(isUnpaidWebsiteCheckoutHold(websiteHold({ booking_source: 'admin' })), false);
  assert.strictEqual(isUnpaidWebsiteCheckoutHold(websiteHold({ staff_created: true })), false);
  assert.strictEqual(isUnpaidWebsiteCheckoutHold(websiteHold({ stripe_payment_id: 'pi_paid' })), false);
  assert.strictEqual(isUnpaidWebsiteCheckoutHold(websiteHold({ deposit_paid: 179.99 })), false);
  assert.strictEqual(isUnpaidWebsiteCheckoutHold(websiteHold({ stripe_checkout_session_id: '' })), false);
}

function runConfirmationAndDocumentGateTests() {
  const hold = websiteHold();
  assert.strictEqual(canSendCustomerBookingConfirmation(hold), false);
  assert.strictEqual(canAccessCustomerTripDocuments(hold), false);
  assert.deepStrictEqual(resolveExistingCheckoutBooking(hold, false), { kind: 'payment_incomplete' });
  assert.deepStrictEqual(resolveExistingCheckoutBooking(hold, true), { kind: 'continue_finalize' });

  const paid = websiteHold({ stripe_payment_id: 'cs_paid', payment_status: 'paid', deposit_paid: 179.99 });
  assert.strictEqual(canSendCustomerBookingConfirmation(paid), true);
  assert.strictEqual(canAccessCustomerTripDocuments(paid), true);
  assert.deepStrictEqual(resolveExistingCheckoutBooking(paid, true), { kind: 'already_finalized' });

  const groupon = { id: 'g1', status: 'pending', booking_source: 'groupon', stripe_checkout_session_id: '' };
  assert.strictEqual(canSendCustomerBookingConfirmation(groupon), true);
  assert.strictEqual(canAccessCustomerTripDocuments(groupon), true);
  assert.deepStrictEqual(resolveExistingCheckoutBooking(groupon, false), { kind: 'already_finalized' });

  const staff = { id: 's1', status: 'confirmed', staff_created: true, booking_source: 'admin' };
  assert.strictEqual(canSendCustomerBookingConfirmation(staff), true);
  assert.strictEqual(canAccessCustomerTripDocuments(staff), true);
}

function runCalendarHideTests() {
  assert.strictEqual(shouldHideFromOperationsCalendar(websiteHold()), true);
  assert.strictEqual(
    shouldHideFromOperationsCalendar(
      websiteHold({ expires_at: new Date(Date.now() + 60_000).toISOString() })
    ),
    false
  );
  assert.strictEqual(
    shouldHideFromOperationsCalendar(
      websiteHold({ status: 'cancelled', admin_notes: 'Checkout hold · expired' })
    ),
    true
  );
  assert.strictEqual(
    shouldHideFromOperationsCalendar({
      status: 'pending',
      booking_source: 'groupon',
      stripe_checkout_session_id: '',
    }),
    false
  );
}

async function runReleaseAndCleanupTests() {
  const db = createFakeSupabase([
    websiteHold({ id: 'patel' }),
    websiteHold({
      id: 'groupon',
      booking_source: 'groupon',
      stripe_checkout_session_id: '',
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    }),
    websiteHold({
      id: 'staff',
      staff_created: true,
      booking_source: 'admin',
      stripe_checkout_session_id: '',
    }),
    websiteHold({
      id: 'paid',
      stripe_payment_id: 'cs_paid',
      payment_status: 'paid',
      deposit_paid: 179.99,
    }),
  ]);

  const missingTarget = await releaseUnpaidCheckoutHold(db, { reason: 'stripe_payment_failed' });
  assert.strictEqual(missingTarget.released, 0);

  const first = await releaseUnpaidCheckoutHold(db, {
    sessionId: 'cs_test_hold',
    reason: 'stripe_checkout_expired',
  });
  assert.strictEqual(first.released, 1);
  assert.deepStrictEqual(first.ids, ['patel']);
  assert.strictEqual(db.store.find((r) => r.id === 'patel').status, 'cancelled');
  assert.strictEqual(db.store.find((r) => r.id === 'groupon').status, 'pending');
  assert.strictEqual(db.store.find((r) => r.id === 'staff').status, 'pending');
  assert.strictEqual(db.store.find((r) => r.id === 'paid').status, 'pending');

  const duplicate = await releaseUnpaidCheckoutHold(db, {
    sessionId: 'cs_test_hold',
    reason: 'stripe_checkout_expired',
  });
  assert.strictEqual(duplicate.released, 0);

  const cleanupDb = createFakeSupabase([
    websiteHold({ id: 'expired' }),
    websiteHold({
      id: 'active',
      expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
    }),
    {
      id: 'groupon-pending',
      status: 'pending',
      payment_status: 'pending',
      booking_source: 'groupon',
      staff_created: false,
      stripe_checkout_session_id: null,
      stripe_payment_id: null,
      deposit_paid: 0,
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    },
  ]);
  const cleaned = await cleanupExpiredCheckoutHolds(cleanupDb);
  assert.strictEqual(cleaned.cancelled, 1);
  assert.strictEqual(cleanupDb.store.find((r) => r.id === 'expired').status, 'cancelled');
  assert.strictEqual(cleanupDb.store.find((r) => r.id === 'active').status, 'pending');
  assert.strictEqual(cleanupDb.store.find((r) => r.id === 'groupon-pending').status, 'pending');
}

async function run() {
  runPredicateTests();
  runConfirmationAndDocumentGateTests();
  runCalendarHideTests();
  await runReleaseAndCleanupTests();
  console.log('checkoutHoldService.test.js: all tests passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
