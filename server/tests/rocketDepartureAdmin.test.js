'use strict';

const assert = require('assert');
const {
  DEPARTURE_STATUS,
  getRocketDepartureAdminDetail,
  applyStaffRocketDepartureOverride,
  buildRocketDepartureSummary,
} = require('../services/rocketDepartureService');

function sharedRocketRow(overrides = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    booking_type: 'charter',
    charter_type: 'rocket',
    charter_seating: 'shared',
    pricing_package_id: 'rocket_solo',
    pricing_package_name: 'Rocket Launch Solo',
    guest_count: 1,
    package_guest_count: 1,
    status: 'confirmed',
    shared_departure_id: '33333333-3333-4333-8333-333333333333',
    departure_confirmation_status: DEPARTURE_STATUS.AWAITING_MINIMUM,
    customers: { full_name: 'Alex Guest', email: 'alex@example.com' },
    ...overrides,
  };
}

function buildSupabase({ booking, groupRows = [] }) {
  return {
    from(table) {
      const filters = {};
      const api = {
        select() {
          return api;
        },
        eq(column, value) {
          filters[column] = value;
          return api;
        },
        in(column, values) {
          filters[`${column}__in`] = values;
          return api;
        },
        order() {
          return api;
        },
        update(payload) {
          return {
            in(column, values) {
              for (const row of groupRows) {
                if (values.includes(row.id)) {
                  Object.assign(row, payload);
                }
              }
              return Promise.resolve({ error: null });
            },
          };
        },
        maybeSingle: async () => {
          if (table === 'bookings' && filters.id === booking.id) {
            return { data: booking, error: null };
          }
          return { data: null, error: null };
        },
      };

      api.then = undefined;
      const originalEq = api.eq.bind(api);
      api.eq = (column, value) => {
        filters[column] = value;
        if (table === 'bookings' && column === 'shared_departure_id') {
          api._groupResult = groupRows.filter((row) => row.shared_departure_id === value);
        }
        return api;
      };

      api.order = () => ({
        then: undefined,
        ...api,
        async catch() {
          return api;
        },
      });

      Object.defineProperty(api, 'then', {
        get() {
          if (table === 'bookings' && filters.shared_departure_id) {
            return (resolve) => resolve({ data: api._groupResult || groupRows, error: null });
          }
          return undefined;
        },
      });

      return api;
    },
  };
}

async function run() {
  const booking = sharedRocketRow();
  const groupRows = [
    sharedRocketRow(),
    sharedRocketRow({
      id: '22222222-2222-4222-8222-222222222222',
      pricing_package_id: 'rocket_duo',
      pricing_package_name: 'Rocket Launch Duo',
      guest_count: 2,
      package_guest_count: 2,
      customers: { full_name: 'Duo Guest', email: 'duo@example.com' },
    }),
  ];
  const supabase = buildSupabase({ booking, groupRows });

  const detail = await getRocketDepartureAdminDetail(supabase, booking.id);
  assert.strictEqual(detail.applicable, true);
  assert.strictEqual(detail.privateCharter, false);
  assert.strictEqual(detail.summary.guestsBooked, 3);
  assert.strictEqual(detail.summary.minimumReached, false);
  assert.strictEqual(detail.departureStatus, DEPARTURE_STATUS.AWAITING_MINIMUM);
  assert.strictEqual(detail.canForceConfirm, true);

  const result = await applyStaffRocketDepartureOverride(supabase, {
    bookingId: booking.id,
    action: 'force_confirm',
    reason: 'Launch window confirmed with operator',
  });
  assert.strictEqual(result.departureStatus, DEPARTURE_STATUS.DEPARTURE_CONFIRMED);
  assert.strictEqual(result.updated, 2);
  assert.strictEqual(groupRows[0].departure_confirmation_status, DEPARTURE_STATUS.DEPARTURE_CONFIRMED);
  assert.strictEqual(groupRows[1].departure_confirmation_status, DEPARTURE_STATUS.DEPARTURE_CONFIRMED);

  const privateDetail = await getRocketDepartureAdminDetail(
    buildSupabase({
      booking: sharedRocketRow({
        charter_seating: 'private',
        pricing_package_id: 'rocket_private',
        shared_departure_id: null,
        departure_confirmation_status: DEPARTURE_STATUS.DEPARTURE_CONFIRMED,
      }),
      groupRows: [],
    }),
    booking.id
  );
  assert.strictEqual(privateDetail.privateCharter, true);
  assert.strictEqual(privateDetail.canForceConfirm, false);

  let rejected = false;
  try {
    await applyStaffRocketDepartureOverride(supabase, {
      bookingId: booking.id,
      action: 'force_confirm',
      reason: 'short',
    });
  } catch (err) {
    rejected = err.statusCode === 400;
  }
  assert.strictEqual(rejected, true);

  console.log('rocketDepartureAdmin.test.js: all tests passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
