#!/usr/bin/env node
/**
 * Batch 6 — static security audit for admin document / waiver / pre-trip workflow.
 * No network or secrets required.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

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

/** Admin routes added in batches 1–4 that must gate on verifyAdminRequest. */
const ADMIN_AUTH_GATED_ROUTES = [
  "app.get('/api/admin/documents/access'",
  "app.get('/api/admin/documents/download'",
  "app.get('/api/admin/bookings/:id/waiver-pdf'",
  "app.get('/api/admin/pre-trip-submissions/:id/waiver-pdf'",
  "app.patch('/api/admin/pre-trip-submissions/:id'",
  "app.get('/api/admin/pre-trip-submissions/:id/suggestions'",
];

/** Document proxy must resolve paths from DB — never accept raw storage paths from client. */
const FORBIDDEN_DOCUMENT_PROXY_PATTERNS = [
  /req\.query\.url\b/,
  /req\.query\.objectPath\b/,
  /req\.query\.path\b/,
  /req\.body\.url\b/,
  /req\.params\.objectPath\b/,
];

function sliceAfter(source, needle, len = 900) {
  const idx = source.indexOf(needle);
  if (idx === -1) return '';
  return source.slice(idx, idx + len);
}

function collectAdminPages(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) collectAdminPages(full, acc);
    else if (/Admin.*\.(tsx|ts)$/.test(name) || name === 'AdminDocumentViewer.tsx') acc.push(full);
  }
  return acc;
}

function main() {
  console.log('Admin security smoke (static audit)\n');

  const serverSource = read('server/server.js');

  for (const route of ADMIN_AUTH_GATED_ROUTES) {
    const block = sliceAfter(serverSource, route);
    if (!block) {
      fail(`Route not found in server.js: ${route}`);
      continue;
    }
    if (!block.includes('verifyAdminRequest')) {
      fail(`${route} handler missing verifyAdminRequest()`);
    }
  }

  const docAccessBlock = sliceAfter(serverSource, "app.get('/api/admin/documents/access'", 1200);
  const docDownloadBlock = sliceAfter(serverSource, "app.get('/api/admin/documents/download'", 1200);

  for (const block of [docAccessBlock, docDownloadBlock]) {
    if (!block.includes('adminDocumentAccessService.resolveAdminDocument')) {
      fail('Document admin route must resolve storage via adminDocumentAccessService.resolveAdminDocument');
    }
    for (const pattern of FORBIDDEN_DOCUMENT_PROXY_PATTERNS) {
      if (pattern.test(block)) {
        fail(`Document admin route must not accept client storage paths (${pattern})`);
      }
    }
  }

  if (!read('server/services/adminDocumentAccessService.js').includes('isRecordUuid')) {
    fail('adminDocumentAccessService must validate record UUIDs');
  }

  if (!read('server/services/adminDocumentAccessService.js').includes('validateResolvedStorageUrl')) {
    fail('adminDocumentAccessService must validate storage URLs before signing');
  }

  if (!read('server/server.js').includes('preTripAdminActions.normalizeRejectionReason')) {
    fail('Pre-trip reject must use preTripAdminActions.normalizeRejectionReason');
  }

  if (!read('server/server.js').includes('preTripAdminActions.preTripTerminalConflict')) {
    fail('Pre-trip PATCH must guard terminal states via preTripAdminActions');
  }

  const reviewMigration = 'supabase/migrations/20260716190000_pre_trip_submissions_review_audit.sql';
  if (!read(reviewMigration).includes('rejection_reason')) {
    fail(`Missing review audit migration: ${reviewMigration}`);
  }

  const supabaseClient = read('src/lib/supabase.ts');
  if (supabaseClient.toLowerCase().includes('service_role')) {
    fail('Frontend supabase client must not reference service role');
  }

  const adminPages = collectAdminPages(join(ROOT, 'src'));
  for (const file of adminPages) {
    const rel = relative(ROOT, file);
    const src = read(rel);
    if (rel.includes('AdminDocumentViewer') || rel.includes('adminDocuments')) continue;
    if (src.includes('license_url') && src.includes('target="_blank"') && src.includes('href={')) {
      if (!src.includes('AdminDocumentViewer')) {
        fail(`${rel} opens license_url directly in browser — use AdminDocumentViewer`);
      }
    }
    if (src.includes('insurance_url') && src.includes('target="_blank"') && src.includes('href={')) {
      if (!src.includes('AdminDocumentViewer')) {
        fail(`${rel} opens insurance_url directly in browser — use AdminDocumentViewer`);
      }
    }
  }

  const storageUpload = read('src/lib/storageUpload.ts');
  if (storageUpload.includes('getPublicUrl') && !storageUpload.includes('createSignedDocumentUrl')) {
    warn('storageUpload.ts still uses getPublicUrl — admin should use signed access endpoints');
  }

  if (read('server/server.js').includes("object/public/${bucket}/${objectPath}")) {
    warn('booking-upload-url still returns public object URLs — buckets may be private in prod');
  }

  console.log(`✓ ${ADMIN_AUTH_GATED_ROUTES.length} admin routes checked for verifyAdminRequest`);
  console.log('✓ Document proxy resolves from DB (no client path params)');
  console.log('✓ Pre-trip reject/terminal guards wired');
  console.log('✓ Review audit migration present');
  console.log(`✓ ${adminPages.length} admin pages scanned for raw document links`);

  if (warnings.length) {
    console.log('\nWarnings (known follow-ups):');
    for (const w of warnings) console.log(`  ⚠ ${w}`);
  }

  if (failures.length) {
    console.error('\nFailures:');
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }

  console.log('\nAll static admin security checks passed.');
}

main();
