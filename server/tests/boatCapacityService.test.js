const assert = require('node:assert/strict');
const test = require('node:test');
const { CAPACITY_STATUS } = require('../lib/boatSafetyCapacity');
const {
  evaluateCapacityApprovalGate,
  applyCapacityOverride,
  getEffectiveCapacityStatus,
} = require('../services/boatCapacityService');

function mockSupabase({ calculation = null, overrides = [] } = {}) {
  return {
    from(table) {
      const chain = {
        select() {
          return chain;
        },
        eq() {
          return chain;
        },
        order() {
          return chain;
        },
        limit() {
          return chain;
        },
        maybeSingle: async () => {
          if (table === 'booking_capacity_calculations') {
            return { data: calculation, error: null };
          }
          if (table === 'booking_capacity_calculations' || table.includes('capacity')) {
            return { data: calculation, error: null };
          }
          return { data: null, error: null };
        },
        insert() {
          return {
            select() {
              return {
                maybeSingle: async () => ({
                  data: {
                    id: 'override-1',
                    original_status: calculation?.status,
                    override_status: CAPACITY_STATUS.WITHIN,
                    reason: 'Captain reviewed weights on dock.',
                    overridden_by: 'admin-1',
                    overridden_at: new Date().toISOString(),
                  },
                  error: null,
                }),
              };
            },
          };
        },
        then(resolve, reject) {
          if (table === 'capacity_calculation_overrides') {
            return Promise.resolve({ data: overrides, error: null }).then(resolve, reject);
          }
          return Promise.resolve({ data: null, error: null }).then(resolve, reject);
        },
      };
      return chain;
    },
  };
}

test('evaluateCapacityApprovalGate allows approve when no calculation exists', async () => {
  const gate = await evaluateCapacityApprovalGate(mockSupabase(), 'booking-1');
  assert.equal(gate.allowApprove, true);
  assert.equal(gate.warning, null);
});

test('evaluateCapacityApprovalGate blocks approve when capacity exceeded', async () => {
  const gate = await evaluateCapacityApprovalGate(
    mockSupabase({ calculation: { id: 'calc-1', status: CAPACITY_STATUS.EXCEEDED } }),
    'booking-1'
  );
  assert.equal(gate.allowApprove, false);
  assert.match(gate.warning, /exceeds/i);
});

test('evaluateCapacityApprovalGate warns on captain review without blocking', async () => {
  const gate = await evaluateCapacityApprovalGate(
    mockSupabase({ calculation: { id: 'calc-2', status: CAPACITY_STATUS.REVIEW } }),
    'booking-1'
  );
  assert.equal(gate.allowApprove, true);
  assert.match(gate.warning, /captain review/i);
});

test('getEffectiveCapacityStatus uses latest override when present', async () => {
  const supabase = mockSupabase({
    calculation: { id: 'calc-3', status: CAPACITY_STATUS.REVIEW },
    overrides: [
      {
        id: 'ov-1',
        original_status: CAPACITY_STATUS.REVIEW,
        override_status: CAPACITY_STATUS.WITHIN,
        reason: 'Dockside review complete.',
        overridden_by: 'admin-1',
        overridden_at: '2026-07-22T12:00:00.000Z',
      },
    ],
  });

  const effective = await getEffectiveCapacityStatus(supabase, { id: 'calc-3', status: CAPACITY_STATUS.REVIEW });
  assert.equal(effective.status, CAPACITY_STATUS.WITHIN);
  assert.equal(effective.calculated_status, CAPACITY_STATUS.REVIEW);
  assert.ok(effective.override);
});

test('applyCapacityOverride rejects short reasons', async () => {
  const supabase = {
    from(table) {
      if (table === 'booking_capacity_calculations') {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          maybeSingle: async () => ({
            data: { id: 'calc-4', status: CAPACITY_STATUS.REVIEW, booking_id: 'booking-4' },
            error: null,
          }),
        };
      }
      return {};
    },
  };

  await assert.rejects(
    () =>
      applyCapacityOverride(supabase, {
        calculationId: 'calc-4',
        overrideStatus: CAPACITY_STATUS.WITHIN,
        reason: 'short',
        adminUserId: 'admin-1',
      }),
    (err) => err.statusCode === 400
  );
});

test('evaluateCapacityApprovalGate respects override when approving pre-trip', async () => {
  const gate = await evaluateCapacityApprovalGate(
    mockSupabase({
      calculation: { id: 'calc-5', status: CAPACITY_STATUS.REVIEW },
      overrides: [
        {
          id: 'ov-2',
          original_status: CAPACITY_STATUS.REVIEW,
          override_status: CAPACITY_STATUS.WITHIN,
          reason: 'Captain approved after gear redistribution.',
          overridden_by: 'admin-1',
          overridden_at: '2026-07-22T12:00:00.000Z',
        },
      ],
    }),
    'booking-1'
  );
  assert.equal(gate.allowApprove, true);
  assert.equal(gate.warning, null);
  assert.equal(gate.effective_status, CAPACITY_STATUS.WITHIN);
});
