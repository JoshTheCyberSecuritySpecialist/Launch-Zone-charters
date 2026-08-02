#!/usr/bin/env node
/**
 * Captain Portal — static connectivity smoke test (no auth).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const failures = [];

function fail(msg) {
  failures.push(msg);
}

function read(rel) {
  return readFileSync(join(ROOT, rel), 'utf8');
}

const REGISTERED_CAPTAIN_ROUTES = [
  '/captain-login',
  '/captain',
  '/captain/schedule',
  '/captain/booking/:id',
];

const REQUIRED_CAPTAIN_APIS = [
  "app.get('/api/captain/verify'",
  "app.get('/api/captain/me'",
  "app.get('/api/captain/bookings'",
  "app.get('/api/captain/bookings/:id'",
  "app.patch('/api/captain/bookings/:id/progress'",
  "app.get('/api/marine-conditions'",
];

const FRONTEND_WIRING = [
  { file: 'src/pages/CaptainDashboard.tsx', needle: 'CaptainMarineConditionsPanel', label: 'dashboard weather panel' },
  { file: 'src/pages/CaptainBookingDetail.tsx', needle: 'CaptainMarineConditionsPanel', label: 'trip detail weather panel' },
  { file: 'src/pages/CaptainBookingDetail.tsx', needle: 'emergency_contact_notes', label: 'emergency contact display' },
  { file: 'src/lib/marineConditions.ts', needle: 'fetchMarineConditions', label: 'marine conditions client' },
  { file: 'src/pages/AdminCaptains.tsx', needle: "from('captains')", label: 'admin captains CRUD' },
  { file: 'src/lib/adminBookingFormState.ts', needle: 'captainId', label: 'admin booking captain assignment' },
];

function extractCaptainRoutes(appSource) {
  const found = [];
  const re = /path="(\/captain[^"]*)"/g;
  let m;
  while ((m = re.exec(appSource))) {
    found.push(m[1]);
  }
  return [...new Set(found)];
}

function main() {
  console.log('Captain portal smoke test (static connectivity)\n');

  const appSource = read('src/App.tsx');
  const appRoutes = extractCaptainRoutes(appSource);
  for (const route of REGISTERED_CAPTAIN_ROUTES) {
    if (!appRoutes.includes(route)) {
      fail(`Registered route missing from App.tsx: ${route}`);
    }
  }

  const serverSource = read('server/server.js');
  for (const needle of REQUIRED_CAPTAIN_APIS) {
    if (!serverSource.includes(needle)) {
      fail(`Missing server route registration: ${needle}`);
    }
  }

  if (!serverSource.includes('verifyCaptainRequest')) {
    fail('Missing verifyCaptainRequest middleware usage for captain APIs');
  }

  if (!serverSource.includes('.eq(\'captain_id\', captainId)')) {
    fail('Captain booking queries must scope by captain_id');
  }

  for (const item of FRONTEND_WIRING) {
    const source = read(item.file);
    if (!source.includes(item.needle)) {
      fail(`Frontend wiring missing (${item.label}): ${item.file} → ${item.needle}`);
    }
  }

  const migration = read('supabase/migrations/20260722060406_captain_portal_phase_a.sql');
  if (!migration.includes('CREATE TABLE IF NOT EXISTS public.captains')) {
    fail('Captain portal migration missing captains table');
  }
  if (!migration.includes('captain_progress')) {
    fail('Captain portal migration missing captain_progress column');
  }

  if (failures.length) {
    console.error('FAILURES:');
    for (const msg of failures) console.error(`  - ${msg}`);
    process.exit(1);
  }

  console.log('All captain portal static checks passed.');
}

main();
