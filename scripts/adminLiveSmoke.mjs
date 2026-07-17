#!/usr/bin/env node
/**
 * Optional live admin API smoke test — requires env:
 *   ADMIN_SMOKE_API_URL  (e.g. https://your-api.onrender.com or http://localhost:3001)
 *   ADMIN_SMOKE_TOKEN    (Supabase JWT for an admin user — optional for unauth checks)
 *
 * Skips gracefully when ADMIN_SMOKE_API_URL is not set.
 */

const API = (process.env.ADMIN_SMOKE_API_URL || '').replace(/\/+$/, '');
const TOKEN = process.env.ADMIN_SMOKE_TOKEN || '';

const FAKE_UUID = '00000000-0000-4000-8000-000000000099';

/** Endpoints that must reject unauthenticated callers. */
const UNAUTH_MUST_401 = [
  { name: 'documents/access (unauth)', path: `/api/admin/documents/access?context=booking&recordId=${FAKE_UUID}&document=license`, method: 'GET' },
  { name: 'documents/download (unauth)', path: `/api/admin/documents/download?context=booking&recordId=${FAKE_UUID}&document=license`, method: 'GET' },
  { name: 'booking waiver-pdf (unauth)', path: `/api/admin/bookings/${FAKE_UUID}/waiver-pdf`, method: 'GET' },
  { name: 'pre-trip waiver-pdf (unauth)', path: `/api/admin/pre-trip-submissions/${FAKE_UUID}/waiver-pdf`, method: 'GET' },
  { name: 'pre-trip PATCH (unauth)', path: `/api/admin/pre-trip-submissions/${FAKE_UUID}`, method: 'PATCH', body: { action: 'reject', rejection_reason: 'smoke test' } },
  { name: 'pre-trip suggestions (unauth)', path: `/api/admin/pre-trip-submissions/${FAKE_UUID}/suggestions`, method: 'GET' },
];

const AUTH_CHECKS = [
  { name: 'verify', path: '/api/admin/verify', method: 'GET', expectOk: true },
  { name: 'operations-dashboard', path: '/api/admin/operations-dashboard', method: 'GET', expectOk: true },
  { name: 'outbox', path: '/api/admin/outbox?limit=1', method: 'GET', expectOk: true },
  { name: 'promo-codes', path: '/api/admin/promo-codes', method: 'GET', expectOk: true },
  { name: 'documents/access invalid uuid', path: '/api/admin/documents/access?context=booking&recordId=not-a-uuid&document=license', method: 'GET', expectStatuses: [400] },
  { name: 'documents/access missing doc', path: `/api/admin/documents/access?context=booking&recordId=${FAKE_UUID}&document=license`, method: 'GET', expectStatuses: [404] },
  { name: 'booking waiver-pdf missing', path: `/api/admin/bookings/${FAKE_UUID}/waiver-pdf`, method: 'GET', expectStatuses: [404] },
  { name: 'pre-trip waiver-pdf missing', path: `/api/admin/pre-trip-submissions/${FAKE_UUID}/waiver-pdf`, method: 'GET', expectStatuses: [404] },
  { name: 'pre-trip suggestions (404 ok)', path: `/api/admin/pre-trip-submissions/${FAKE_UUID}/suggestions`, method: 'GET', expectStatuses: [404, 400] },
];

async function request(path, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const init = { method, headers };
  if (body != null) init.body = JSON.stringify(body);
  return fetch(`${API}${path}`, init);
}

async function run() {
  if (!API) {
    console.log('adminLiveSmoke: skipped (set ADMIN_SMOKE_API_URL to run live checks)');
    process.exit(0);
  }

  console.log(`Admin live smoke against ${API}\n`);
  const failures = [];

  for (const check of UNAUTH_MUST_401) {
    try {
      const res = await request(check.path, { method: check.method, body: check.body });
      if (res.status !== 401) {
        const body = await res.text().catch(() => '');
        failures.push(`${check.name}: expected 401, got ${res.status} — ${body.slice(0, 120)}`);
      } else {
        console.log(`✓ ${check.name} (${res.status})`);
      }
    } catch (err) {
      failures.push(`${check.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (!TOKEN) {
    console.log('\n(admin auth checks skipped — set ADMIN_SMOKE_TOKEN for full live smoke)');
  } else {
    for (const check of AUTH_CHECKS) {
      try {
        const res = await request(check.path, { method: check.method, token: TOKEN });
        const allowed = check.expectStatuses || (check.expectOk ? [200] : []);
        if (!allowed.includes(res.status)) {
          const body = await res.text().catch(() => '');
          failures.push(`${check.name}: expected ${allowed.join('|')}, got ${res.status} — ${body.slice(0, 120)}`);
        } else {
          console.log(`✓ ${check.name} (${res.status})`);
        }
      } catch (err) {
        failures.push(`${check.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  if (failures.length) {
    console.error('\nLive smoke failures:');
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }

  console.log('\nLive admin smoke passed.');
}

run();
