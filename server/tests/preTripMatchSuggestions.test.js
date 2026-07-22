const assert = require('node:assert/strict');
const test = require('node:test');
const { findPreTripMatchSuggestions } = require('../services/preTripMatchSuggestions');

function mockSupabase(responses) {
  return {
    from(table) {
      const chain = {
        select() {
          return chain;
        },
        eq(_col, val) {
          chain._eqVal = val;
          return chain;
        },
        ilike() {
          return chain;
        },
        not() {
          return chain;
        },
        order() {
          return chain;
        },
        limit() {
          return chain;
        },
        gte() {
          return chain;
        },
        lte() {
          return chain;
        },
        maybeSingle: async () => {
          if (table === 'customers' && chain._eqVal) {
            return { data: responses.customerById || null, error: null };
          }
          return { data: null, error: null };
        },
        then(resolve, reject) {
          if (table === 'bookings') {
            return Promise.resolve({ data: responses.bookings || [], error: null }).then(resolve, reject);
          }
          if (table === 'customers') {
            return Promise.resolve({ data: responses.customers || [], error: null }).then(resolve, reject);
          }
          return Promise.resolve({ data: [], error: null }).then(resolve, reject);
        },
      };
      return chain;
    },
  };
}

test('findPreTripMatchSuggestions logs zero-match hints and returns email matches', async () => {
  const submission = {
    id: 'sub-1',
    email: 'guest@example.com',
    phone: '(803) 555-0100',
    customer_name: 'Jane Guest',
    requested_trip_date: null,
    groupon_code: null,
  };

  const supabase = mockSupabase({
    customers: [
      {
        id: 'cust-1',
        full_name: 'Jane Guest',
        email: 'guest@example.com',
        phone: '8035550100',
      },
    ],
    bookings: [
      {
        id: 'book-1',
        customer_id: 'cust-1',
        start_time: '2026-08-01T14:00:00.000Z',
        status: 'confirmed',
        promo_code: null,
        boats: { name: 'Key Largo' },
      },
    ],
    customerById: {
      full_name: 'Jane Guest',
      email: 'guest@example.com',
      phone: '8035550100',
    },
  });

  const { suggestions, diagnostics } = await findPreTripMatchSuggestions(supabase, submission);
  assert.ok(suggestions.length >= 1);
  assert.equal(suggestions[0].id, 'book-1');
  assert.ok(diagnostics.hints.includes('requested_trip_date_missing'));
});

test('findPreTripMatchSuggestions reports email_no_customer when nothing found', async () => {
  const submission = {
    id: 'sub-2',
    email: 'missing@example.com',
    phone: null,
    customer_name: null,
    requested_trip_date: null,
    groupon_code: null,
  };

  const supabase = mockSupabase({ customers: [], bookings: [] });
  const { suggestions, diagnostics } = await findPreTripMatchSuggestions(supabase, submission);
  assert.equal(suggestions.length, 0);
  assert.ok(diagnostics.hints.includes('email_no_customer'));
  assert.ok(diagnostics.hints.includes('phone_missing_or_short'));
});
