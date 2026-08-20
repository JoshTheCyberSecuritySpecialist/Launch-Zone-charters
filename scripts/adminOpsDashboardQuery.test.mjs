/**
 * Contract tests for ops dashboard query strings.
 * Keep in sync with src/lib/adminOpsDashboardQuery.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';

function buildOperationsDashboardPath(query) {
  const params = new URLSearchParams();
  if (query?.sort) params.set('sort', query.sort);
  const filter = query?.filter != null ? String(query.filter).trim() : '';
  if (filter) params.set('filter', filter);
  const qs = params.toString();
  return `/api/admin/operations-dashboard${qs ? `?${qs}` : ''}`;
}

function buildOperationsDashboardDeltaPath(query) {
  const params = new URLSearchParams();
  params.set('since', query.since);
  if (query?.sort) params.set('sort', query.sort);
  const filter = query?.filter != null ? String(query.filter).trim() : '';
  if (filter) params.set('filter', filter);
  return `/api/admin/operations-dashboard/delta?${params.toString()}`;
}

test('delta path requires since', () => {
  assert.equal(
    buildOperationsDashboardDeltaPath({ since: '2026-08-19T12:00:00.000Z', sort: 'trip_date' }),
    '/api/admin/operations-dashboard/delta?since=2026-08-19T12%3A00%3A00.000Z&sort=trip_date'
  );
});

test('all new omits filter param', () => {
  assert.equal(buildOperationsDashboardPath({ sort: 'trip_date' }), '/api/admin/operations-dashboard?sort=trip_date');
  assert.equal(buildOperationsDashboardPath({}), '/api/admin/operations-dashboard');
});

test('today and sort combine', () => {
  assert.equal(
    buildOperationsDashboardPath({ sort: 'trip_date', filter: 'today' }),
    '/api/admin/operations-dashboard?sort=trip_date&filter=today'
  );
});

test('tomorrow filter', () => {
  assert.equal(buildOperationsDashboardPath({ filter: 'tomorrow' }), '/api/admin/operations-dashboard?filter=tomorrow');
});

test('this week uses week token not this-week', () => {
  assert.equal(buildOperationsDashboardPath({ filter: 'week' }), '/api/admin/operations-dashboard?filter=week');
});

test('empty filter string omitted', () => {
  assert.equal(buildOperationsDashboardPath({ filter: '' }), '/api/admin/operations-dashboard');
});

test('sort change included', () => {
  assert.equal(
    buildOperationsDashboardPath({ sort: 'recently_booked', filter: 'today' }),
    '/api/admin/operations-dashboard?sort=recently_booked&filter=today'
  );
});

console.log('adminOpsDashboardQuery.test.mjs: all tests passed');
