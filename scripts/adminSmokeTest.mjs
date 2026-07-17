#!/usr/bin/env node
/**
 * Phase 10 — static admin connectivity smoke test.
 * Verifies routes, internal links, and server API registrations without auth.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/** React Router paths registered for admin (from App.tsx). */
const REGISTERED_ADMIN_ROUTES = [
  '/admin-login',
  '/admin',
  '/admin/more',
  '/admin/bookings',
  '/admin/bookings/list',
  '/admin/bookings/:id',
  '/admin/staff-booking',
  '/admin/calendar',
  '/admin/approvals',
  '/admin/messages',
  '/admin/pre-trip',
  '/admin/pre-trip/:id',
  '/admin/promo-codes',
  '/admin/captains-log',
  '/admin/outbox',
  '/admin/disputes',
  '/admin/shop-orders',
  '/admin/boats',
];

/** Critical admin APIs used by the portal. */
const REQUIRED_ADMIN_APIS = [
  "app.get('/api/admin/verify'",
  "app.get('/api/admin/operations-dashboard'",
  "app.get('/api/admin/calendar-bookings'",
  "app.get('/api/admin/calendar-items'",
  "app.post('/api/admin/staff-bookings'",
  "app.get('/api/admin/bookings/:id'",
  "app.patch('/api/admin/bookings/:id'",
  "app.get('/api/admin/documents/access'",
  "app.get('/api/admin/documents/download'",
  "app.get('/api/admin/bookings/:id/waiver-pdf'",
  "app.get('/api/admin/pre-trip-submissions/:id/waiver-pdf'",
  "app.post('/api/admin/bookings/:id/actions'",
  "app.post('/api/admin/bookings/:id/communications/send'",
  "app.patch('/api/admin/pre-trip-submissions/:id'",
  "app.get('/api/admin/pre-trip-submissions/:id/suggestions'",
  "app.get('/api/admin/payment-recovery'",
  "app.get('/api/admin/outbox'",
  "app.get('/api/admin/disputes'",
  "app.get('/api/admin/shop-orders'",
  "app.get('/api/admin/promo-codes'",
  "app.post('/api/admin/contact-messages/:id/reply/send'",
  "app.get('/api/admin/subscribers'",
  "app.get('/api/admin/alerts'",
];

/** Frontend fetch paths that must exist on the server. */
const FRONTEND_API_WIRING = [
  { file: 'src/lib/publicBooking.ts', needle: '/api/admin/pre-trip-submissions/', label: 'pre-trip admin PATCH' },
  { file: 'src/lib/adminDocuments.ts', needle: '/api/admin/documents/access', label: 'admin document access' },
  { file: 'src/lib/adminWaivers.ts', needle: '/waiver-pdf', label: 'admin waiver PDF download' },
  { file: 'src/pages/AdminPreTripDetail.tsx', needle: 'PreTripReviewActions', label: 'pre-trip detail review actions' },
  { file: 'src/components/admin/AdminDocumentViewer.tsx', needle: 'AdminDocumentViewer', label: 'admin document viewer component' },
  { file: 'src/lib/publicBooking.ts', needle: '/suggestions', label: 'pre-trip suggestions GET' },
  { file: 'src/pages/AdminOperationsDashboard.tsx', needle: '/api/admin/operations-dashboard', label: 'ops dashboard' },
  { file: 'src/pages/Admin.tsx', needle: '/api/admin/payment-recovery', label: 'payment recovery' },
];

const failures = [];
const warnings = [];

function fail(msg) {
  failures.push(msg);
}

function warn(msg) {
  warnings.push(msg);
}

function read(rel) {
  return readFileSync(join(ROOT, rel), 'utf8');
}

function routePatternToRegex(pattern) {
  const escaped = pattern.replace(/:[^/]+/g, '[^/]+');
  return new RegExp(`^${escaped}$`);
}

function matchesRegisteredRoute(pathname) {
  const path = pathname.replace(/\/+$/, '') || '/';
  return REGISTERED_ADMIN_ROUTES.some((route) => routePatternToRegex(route).test(path));
}

function extractAppRoutes(appSource) {
  const found = [];
  const re = /path="(\/admin[^"]*)"/g;
  let m;
  while ((m = re.exec(appSource))) {
    found.push(m[1]);
  }
  return [...new Set(found)];
}

function collectSourceFiles(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      collectSourceFiles(full, acc);
    } else if (/\.(tsx?|jsx?)$/.test(name)) {
      acc.push(full);
    }
  }
  return acc;
}

function extractInternalAdminLinks(source) {
  const links = new Set();
  const patterns = [
    /to="(\/admin[^"#?]*[^"]*)"/g,
    /href="(\/admin[^"#?]*[^"]*)"/g,
    /to={'(\/admin[^'#?]*)'/g,
    /to={`(\/admin[^`#?]*)/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(source))) {
      const raw = m[1].split('#')[0].split('?')[0].replace(/\/+$/, '') || '/';
      if (raw.startsWith('/admin')) links.add(raw);
    }
  }
  return links;
}

function main() {
  console.log('Admin smoke test (static connectivity)\n');

  const appSource = read('src/App.tsx');
  const appRoutes = extractAppRoutes(appSource);

  for (const route of REGISTERED_ADMIN_ROUTES) {
    if (!appRoutes.includes(route)) {
      fail(`Registered route missing from App.tsx: ${route}`);
    }
  }

  for (const route of appRoutes) {
    if (!REGISTERED_ADMIN_ROUTES.includes(route)) {
      fail(`App.tsx route not in registry (update scripts/adminSmokeTest.mjs): ${route}`);
    }
  }

  const serverSource = read('server/server.js');
  for (const api of REQUIRED_ADMIN_APIS) {
    if (!serverSource.includes(api)) {
      fail(`Server missing admin API registration: ${api}`);
    }
  }

  for (const { file, needle, label } of FRONTEND_API_WIRING) {
    const src = read(file);
    if (!src.includes(needle)) {
      fail(`Frontend wiring missing for ${label} in ${file}`);
    }
  }

  const srcDir = join(ROOT, 'src');
  const allLinks = new Set();
  for (const file of collectSourceFiles(srcDir)) {
    const rel = relative(ROOT, file);
    const links = extractInternalAdminLinks(read(rel));
    for (const link of links) allLinks.add(link);
  }

  for (const link of [...allLinks].sort()) {
    if (!matchesRegisteredRoute(link)) {
      fail(`Internal admin link does not match any registered route: ${link}`);
    }
  }

  const navSource = read('src/components/admin/adminNav.ts');
  const navRoutes = [...navSource.matchAll(/to: '(\/admin[^']+)'/g)].map((m) => m[1]);
  for (const route of navRoutes) {
    if (!matchesRegisteredRoute(route)) {
      fail(`adminNav link not registered: ${route}`);
    }
  }

  const bottomNav = read('src/components/admin/AdminBottomNav.tsx');
  const bottomRoutes = [...bottomNav.matchAll(/to: '(\/admin[^']+)'/g)].map((m) => m[1]);
  for (const route of bottomRoutes) {
    if (!matchesRegisteredRoute(route)) {
      fail(`AdminBottomNav link not registered: ${route}`);
    }
  }

  if (!read('src/pages/AdminPreTripDetail.tsx').includes('adminUpdatePreTripSubmission')) {
    fail('Pre-trip approve handler missing from AdminPreTripDetail.tsx');
  }
  if (!read('src/pages/AdminApprovals.tsx').includes("from('pre_trip_submissions')")) {
    fail('Approvals pre-trip queue query missing');
  }
  if (read('src/pages/AdminApprovals.tsx').includes('customer_email')) {
    fail('AdminApprovals still references invalid customer_email column');
  }

  console.log(`✓ ${REGISTERED_ADMIN_ROUTES.length} admin routes registered in App.tsx`);
  console.log(`✓ ${REQUIRED_ADMIN_APIS.length} critical admin APIs found in server.js`);
  console.log(`✓ ${allLinks.size} internal admin links validated`);
  console.log(`✓ Nav + bottom nav links validated`);

  if (warnings.length) {
    console.log('\nWarnings:');
    for (const w of warnings) console.log(`  ⚠ ${w}`);
  }

  if (failures.length) {
    console.error('\nFailures:');
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }

  console.log('\nAll static admin smoke checks passed.');
}

main();
