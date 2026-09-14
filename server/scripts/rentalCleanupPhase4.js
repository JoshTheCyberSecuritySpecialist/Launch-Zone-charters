/**
 * Phase 4 rental cleanup — dry-run by default.
 *
 * Usage (from repo root or /server):
 *   node server/scripts/rentalCleanupPhase4.js
 *   node server/scripts/rentalCleanupPhase4.js --dry-run
 *   node server/scripts/rentalCleanupPhase4.js --execute   # ONLY after explicit approval
 *
 * Never imported by server startup. Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

function printSection(title, rows) {
  console.log(`\n=== ${title} (${rows.length}) ===`);
  if (!rows.length) {
    console.log('(none)');
    return;
  }
  for (const row of rows) {
    console.log(JSON.stringify(row));
  }
}

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes('--execute');
  if (execute && args.includes('--dry-run')) {
    console.error('Pass either --dry-run (default) or --execute, not both.');
    process.exit(1);
  }

  const url = String(process.env.SUPABASE_URL || '').trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in server/.env (or repo .env).');
    console.error('Dry-run cannot query production without credentials. Script is ready; re-run when env is available.');
    process.exit(2);
  }

  // Lazy-load so missing env fails with a clear message instead of createClient throw.
  const supabase = require('../supabaseClient');
  const {
    scanRentalCleanupCandidates,
    executeRentalCleanup,
  } = require('../services/rentalCleanupService');

  console.log(execute ? 'MODE: EXECUTE (mutations enabled)' : 'MODE: dry-run (no mutations)');
  console.log('Scanning rental cleanup candidates…');

  const scan = await scanRentalCleanupCandidates(supabase);
  console.log('\n--- Audit summary ---');
  console.log(JSON.stringify({ scannedAt: scan.scannedAt, totals: scan.totals, errors: scan.errors }, null, 2));

  printSection('EXPIRED RENTAL CHECKOUT HOLDS (actionable)', scan.candidates.expiredCheckoutHolds);
  printSection('EXPIRED RENTAL STAFF HOLDS (actionable)', scan.candidates.expiredStaffHolds);
  printSection('PAST RENTAL-SCOPED blocked_dates (actionable)', scan.candidates.pastRentalScopedBlocks);
  printSection('MANUAL REVIEW: block_scope=all (NOT auto-cleared)', scan.manualReview.blockScopeAll);
  printSection(
    'MANUAL REVIEW: admin_calendar_items (NOT auto-cleared)',
    scan.manualReview.adminCalendarBlockingItems
  );
  printSection('SKIPPED / PROTECTED', scan.manualReview.skippedProtected);

  if (!execute) {
    console.log('\nDry-run complete. No records were modified.');
    console.log('To mutate only the actionable lists above, re-run with --execute after approval:');
    console.log('  node server/scripts/rentalCleanupPhase4.js --execute');
    return;
  }

  console.log('\nExecuting cleanup on re-validated actionable rows only…');
  const result = await executeRentalCleanup(supabase, scan);
  console.log('\n--- Execution result ---');
  console.log(JSON.stringify(result, null, 2));
  console.log('\nDone. Charter, paid, confirmed, active holds, Groupon, and shared-scope blocks were not targeted.');
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
