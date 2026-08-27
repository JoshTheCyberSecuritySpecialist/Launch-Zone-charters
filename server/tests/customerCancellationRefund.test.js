'use strict';

const assert = require('assert');
const calc = require('../lib/customerCancellationRefund');
const service = require('../services/customerCancellationRefundService');

function runCalculatorTests() {
  const ninety = calc.calculateCustomerCancellationRefund({ amountPaidCents: 8999 });
  assert.strictEqual(ninety.feeCents, 291);
  assert.strictEqual(ninety.netRefundCents, 8708);
  assert.strictEqual(ninety.canRefund, true);

  const solo = calc.calculateCustomerCancellationRefund({ amountPaidCents: 4499 });
  assert.strictEqual(solo.feeCents, 160);
  assert.strictEqual(solo.netRefundCents, 4339);

  const privateRocket = calc.calculateCustomerCancellationRefund({ amountPaidCents: 45000 });
  assert.strictEqual(privateRocket.feeCents, 1335);
  assert.strictEqual(privateRocket.netRefundCents, 43665);

  const already = calc.calculateCustomerCancellationRefund({
    amountPaidCents: 8999,
    alreadyRefundedCents: 8999,
  });
  assert.strictEqual(already.remainingCents, 0);
  assert.strictEqual(already.feeCents, 0);
  assert.strictEqual(already.netRefundCents, 0);
  assert.strictEqual(already.canRefund, false);

  const partial = calc.calculateCustomerCancellationRefund({
    amountPaidCents: 8999,
    alreadyRefundedCents: 4000,
  });
  assert.strictEqual(partial.remainingCents, 4999);
  assert.ok(partial.netRefundCents + partial.feeCents === partial.remainingCents);
  assert.ok(partial.netRefundCents >= 0);
  assert.ok(partial.feeCents <= partial.remainingCents);

  const tiny = calc.calculateCustomerCancellationRefund({ amountPaidCents: 20 });
  assert.strictEqual(tiny.feeCents, 20);
  assert.strictEqual(tiny.netRefundCents, 0);

  const operator = calc.calculateOperatorCancellationRefund({ amountPaidCents: 8999 });
  assert.strictEqual(operator.feeCents, 0);
  assert.strictEqual(operator.netRefundCents, 8999);

  const over = calc.calculateCustomerCancellationRefund({
    amountPaidCents: 1000,
    alreadyRefundedCents: 1500,
  });
  assert.strictEqual(over.remainingCents, 0);
  assert.strictEqual(over.netRefundCents, 0);
  assert.strictEqual(over.wouldOverRefund, true);
}

function runWindowTests() {
  const start = new Date('2026-09-01T18:00:00.000Z');
  assert.strictEqual(calc.customerRefundWindowOpen(start, new Date('2026-08-30T17:59:59.000Z')), true);
  assert.strictEqual(calc.customerRefundWindowOpen(start, new Date('2026-08-30T18:00:00.000Z')), true);
  assert.strictEqual(calc.customerRefundWindowOpen(start, new Date('2026-08-30T18:00:01.000Z')), false);
  assert.strictEqual(calc.customerRefundWindowOpen(start, new Date('2026-09-01T12:00:00.000Z')), false);
}

function runPolicyCopyTests() {
  const sentence = calc.feePolicySentence();
  assert.match(sentence, /2\.9%/);
  assert.match(sentence, /\$0\.30/);
  assert.match(sentence, /payment processing and administrative fee/);
  assert.doesNotMatch(sentence, /Stripe/i);

  const policy = require('../content/cancellationRefundPolicy');
  const hours48 = policy.CANCELLATION_REFUND_POLICY_SUBSECTIONS[0];
  assert.match(hours48.body, /2\.9% of the original payment plus \$0\.30/);
  const feeSection = policy.CANCELLATION_REFUND_POLICY_SUBSECTIONS.find(
    (row) => row.heading === 'Payment Processing and Administrative Fee'
  );
  assert.strictEqual(feeSection.body, sentence);
}

async function runPreviewAndIssueTests() {
  const start = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
  const booking = {
    id: '11111111-1111-1111-1111-111111111111',
    start_time: start,
    deposit_paid: 89.99,
    payment_intent_id: 'pi_test_1',
    payment_method: 'stripe',
    booking_source: 'website',
    admin_notes: null,
    status: 'confirmed',
    payment_status: 'paid',
  };

  const stripe = {
    paymentIntents: {
      retrieve: async () => ({ amount_received: 8999, amount: 8999, currency: 'usd', status: 'succeeded' }),
    },
    refunds: {
      list: async () => ({ data: [] }),
      create: async (params, opts) => {
        assert.strictEqual(params.payment_intent, 'pi_test_1');
        assert.strictEqual(params.amount, 8708);
        assert.ok(opts.idempotencyKey.includes('customer-refund'));
        return { id: 're_test_1', amount: params.amount };
      },
    },
  };

  const preview = await service.previewBookingRefund({ stripe, booking, kind: 'customer' });
  assert.strictEqual(preview.ok, true);
  assert.strictEqual(preview.quote.feeCents, 291);
  assert.strictEqual(preview.quote.netRefundCents, 8708);

  const tooSoon = {
    ...booking,
    start_time: new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString(),
  };
  const blocked = await service.previewBookingRefund({ stripe, booking: tooSoon, kind: 'customer' });
  assert.strictEqual(blocked.ok, false);
  assert.match(blocked.error, /48\+/);

  const operatorPreview = await service.previewBookingRefund({
    stripe,
    booking: tooSoon,
    kind: 'operator',
  });
  assert.strictEqual(operatorPreview.ok, true);
  assert.strictEqual(operatorPreview.quote.feeCents, 0);
  assert.strictEqual(operatorPreview.quote.netRefundCents, 8999);

  const groupon = await service.previewBookingRefund({
    stripe,
    booking: { ...booking, payment_method: 'groupon', booking_source: 'groupon' },
    kind: 'customer',
  });
  assert.strictEqual(groupon.ok, false);
  assert.match(groupon.error, /Groupon/);

  const updates = [];
  const activities = [];
  const issued = await service.issueBookingRefund({
    stripe,
    supabase: {
      from: () => ({
        update: (patch) => {
          updates.push(patch);
          return { eq: async () => ({ error: null }) };
        },
      }),
    },
    bookingReliability: {
      insertActivity: async (_db, row) => {
        activities.push(row);
      },
    },
    booking,
    adminUserId: 'admin-1',
    kind: 'customer',
  });
  assert.strictEqual(issued.ok, true);
  assert.strictEqual(issued.refundId, 're_test_1');
  assert.strictEqual(updates[0].status, 'cancelled');
  assert.strictEqual(updates[0].payment_status, 'refunded');
  assert.strictEqual(activities[0].event_type, 'refund_issued');
  assert.strictEqual(activities[0].payload.fee_cents, 291);

  const alreadyStripe = {
    paymentIntents: stripe.paymentIntents,
    refunds: {
      list: async () => ({ data: [{ id: 're_old', amount: 8999, status: 'succeeded' }] }),
      create: async () => {
        throw new Error('should not create');
      },
    },
  };
  const dup = await service.previewBookingRefund({ stripe: alreadyStripe, booking, kind: 'customer' });
  assert.strictEqual(dup.ok, false);
  assert.match(dup.error, /already been fully refunded/);
}

async function run() {
  runCalculatorTests();
  runWindowTests();
  runPolicyCopyTests();
  await runPreviewAndIssueTests();
  console.log('customerCancellationRefund.test.js: all tests passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
