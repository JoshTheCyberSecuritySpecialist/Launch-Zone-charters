const assert = require('node:assert/strict');
const test = require('node:test');
const { CAPACITY_STATUS } = require('../lib/boatSafetyCapacity');
const { evaluateCapacityApprovalGate } = require('../services/boatCapacityService');

test('evaluateCapacityApprovalGate allows approve when no calculation exists', async () => {
  const supabase = {
    from(table) {
      assert.equal(table, 'booking_capacity_calculations');
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        order() {
          return this;
        },
        limit() {
          return this;
        },
        maybeSingle: async () => ({ data: null, error: null }),
      };
    },
  };

  const gate = await evaluateCapacityApprovalGate(supabase, 'booking-1');
  assert.equal(gate.allowApprove, true);
  assert.equal(gate.warning, null);
});

test('evaluateCapacityApprovalGate blocks approve when capacity exceeded', async () => {
  const supabase = {
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        order() {
          return this;
        },
        limit() {
          return this;
        },
        maybeSingle: async () => ({
          data: { id: 'calc-1', status: CAPACITY_STATUS.EXCEEDED },
          error: null,
        }),
      };
    },
  };

  const gate = await evaluateCapacityApprovalGate(supabase, 'booking-1');
  assert.equal(gate.allowApprove, false);
  assert.match(gate.warning, /exceeds/i);
});

test('evaluateCapacityApprovalGate warns on captain review without blocking', async () => {
  const supabase = {
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        order() {
          return this;
        },
        limit() {
          return this;
        },
        maybeSingle: async () => ({
          data: { id: 'calc-2', status: CAPACITY_STATUS.REVIEW },
          error: null,
        }),
      };
    },
  };

  const gate = await evaluateCapacityApprovalGate(supabase, 'booking-1');
  assert.equal(gate.allowApprove, true);
  assert.match(gate.warning, /captain review/i);
});
