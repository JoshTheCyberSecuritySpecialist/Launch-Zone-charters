#!/usr/bin/env node
/**
 * Optional live admin API smoke test — requires env:
 *   ADMIN_SMOKE_API_URL  (e.g. https://your-api.onrender.com)
 *   ADMIN_SMOKE_TOKEN    (Supabase JWT for an admin user)
 *
 * Skips gracefully when env is not set.
 */

const API = (process.env.ADMIN_SMOKE_API_URL || '').replace(/\/+$/, '');
const TOKEN = process.env.ADMIN_SMOKE_TOKEN || '';

const checks = [
  { name: 'verify', path: '/api/admin/verify', method: 'GET', expectOk: true },
  { name: 'operations-dashboard', path: '/api/admin/operations-dashboard', method: 'GET', expectOk: true },
  { name: 'outbox', path: '/api/admin/outbox?limit=1', method: 'GET', expectOk: true },
  { name: 'promo-codes', path: '/api/admin/promo-codes', method: 'GET', expectOk: true },
  { name: 'pre-trip suggestions (404 ok)', path: '/api/admin/pre-trip-submissions/00000000-0000-4000-8000-000000000099/suggestions', method: 'GET', expectStatuses: [404, 400] },
];

async function run() {
  if (!API || !TOKEN) {
    console.log('adminLiveSmoke: skipped (set ADMIN_SMOKE_API_URL + ADMIN_SMOKE_TOKEN to run live checks)');
    process.exit(0);
  }

  console.log(`Admin live smoke against ${API}\n`);
  const failures = [];

  for (const check of checks) {
    try {
      const res = await fetch(`${API}${check.path}`, {
        method: check.method,
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
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

  if (failures.length) {
    console.error('\nLive smoke failures:');
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }

  console.log('\nLive admin smoke passed.');
}

run();
