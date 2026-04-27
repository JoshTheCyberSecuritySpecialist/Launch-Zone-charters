/**
 * Dev utility: delete all bookings and related rows so you can test from a clean slate.
 * Uses SUPABASE_SERVICE_ROLE_KEY from server/.env (never commit real keys).
 *
 * Usage (from repo root): node server/scripts/clear-all-bookings.js --yes
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const supabase = require('../supabaseClient');

const NIL = '00000000-0000-0000-0000-000000000000';

async function deleteAll(table, column = 'id') {
  const q = supabase.from(table).delete();
  const { error } =
    column === 'stripe_session_id'
      ? await q.neq(column, '')
      : await q.neq(column, NIL);
  if (error) {
    if (/relation|does not exist|schema cache/i.test(String(error.message))) {
      console.warn(`[skip] ${table}: ${error.message}`);
      return { skipped: true };
    }
    throw new Error(`${table}: ${error.message}`);
  }
  console.log(`[ok] cleared ${table}`);
  return { skipped: false };
}

async function main() {
  const yes = process.argv.includes('--yes');
  if (!yes) {
    console.error('Refusing to run without --yes (destructive). Example: node server/scripts/clear-all-bookings.js --yes');
    process.exit(1);
  }
  const url = String(process.env.SUPABASE_URL || '').trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in server/.env');
    process.exit(1);
  }

  console.log('Clearing booking-related data…');

  await deleteAll('incident_photos');
  await deleteAll('incidents');
  await deleteAll('waivers');
  await deleteAll('user_verifications');
  await deleteAll('checkout_drafts', 'stripe_session_id');
  await deleteAll('bookings');

  console.log('Done. Customers, boats, and admins were not modified.');
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
