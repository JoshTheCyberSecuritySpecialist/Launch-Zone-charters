/**
 * Bulk-import Groupon/voucher codes into the groupon_codes table (service role).
 * Uses SUPABASE_SERVICE_ROLE_KEY from server/.env (never commit real keys).
 *
 * CSV columns (header row required):
 *   code, discount_type, discount_amount, applies_to, expires_at
 *
 * - code:            required; trimmed + uppercased
 * - discount_type:   'fixed' (USD off) or 'percent'; default 'fixed'
 * - discount_amount: number; default 0
 * - applies_to:      eligibility key (e.g. bio_tour, bio_shared, any); default 'bio_tour'
 * - expires_at:      ISO date/datetime or blank for no expiry
 *
 * Existing codes are updated (upsert on `code`); used_count / redeemed fields are
 * left untouched so re-importing a roster does not reset redemptions.
 *
 * Usage (from repo root):
 *   node server/scripts/import-groupon-codes.js ./codes.csv
 *   node server/scripts/import-groupon-codes.js ./codes.csv --dry-run
 */
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const supabase = require('../supabaseClient');

const VALID_DISCOUNT_TYPES = new Set(['fixed', 'percent']);

/** Minimal CSV parser supporting quoted fields and commas inside quotes. */
function parseCsv(text) {
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    if (row.some((c) => c.trim() !== '')) rows.push(row);
  }
  return rows;
}

function normalizeRow(headers, cells) {
  const get = (name) => {
    const idx = headers.indexOf(name);
    return idx === -1 ? '' : String(cells[idx] ?? '').trim();
  };

  const code = get('code').toUpperCase();
  if (!code) return { error: 'missing code' };

  const discountTypeRaw = get('discount_type').toLowerCase() || 'fixed';
  const discountType = VALID_DISCOUNT_TYPES.has(discountTypeRaw) ? discountTypeRaw : 'fixed';

  const discountAmountRaw = get('discount_amount');
  const discountAmount = discountAmountRaw === '' ? 0 : Number(discountAmountRaw);
  if (!Number.isFinite(discountAmount) || discountAmount < 0) {
    return { error: `invalid discount_amount "${discountAmountRaw}"` };
  }

  const appliesTo = get('applies_to') || 'bio_tour';

  const expiresRaw = get('expires_at');
  let expiresAt = null;
  if (expiresRaw) {
    const d = new Date(expiresRaw);
    if (!Number.isFinite(d.getTime())) return { error: `invalid expires_at "${expiresRaw}"` };
    expiresAt = d.toISOString();
  }

  return {
    row: {
      code,
      discount_type: discountType,
      discount_amount: discountAmount,
      applies_to: appliesTo,
      expires_at: expiresAt,
      status: 'active',
    },
  };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const csvPath = args.find((a) => !a.startsWith('--'));

  if (!csvPath) {
    console.error('Usage: node server/scripts/import-groupon-codes.js <file.csv> [--dry-run]');
    process.exit(1);
  }
  const url = String(process.env.SUPABASE_URL || '').trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in server/.env');
    process.exit(1);
  }

  const abs = path.resolve(process.cwd(), csvPath);
  if (!fs.existsSync(abs)) {
    console.error(`File not found: ${abs}`);
    process.exit(1);
  }

  const rows = parseCsv(fs.readFileSync(abs, 'utf8'));
  if (rows.length < 2) {
    console.error('CSV must have a header row and at least one data row.');
    process.exit(1);
  }

  const headers = rows[0].map((h) => h.trim().toLowerCase());
  if (!headers.includes('code')) {
    console.error('CSV header must include a "code" column.');
    process.exit(1);
  }

  const valid = [];
  const errors = [];
  const seen = new Set();
  for (let i = 1; i < rows.length; i += 1) {
    const { row, error } = normalizeRow(headers, rows[i]);
    if (error) {
      errors.push(`Line ${i + 1}: ${error}`);
      continue;
    }
    if (seen.has(row.code)) {
      errors.push(`Line ${i + 1}: duplicate code "${row.code}" in file (skipped)`);
      continue;
    }
    seen.add(row.code);
    valid.push(row);
  }

  console.log(`Parsed ${valid.length} valid code(s), ${errors.length} problem row(s).`);
  errors.forEach((e) => console.warn(`  [skip] ${e}`));

  if (valid.length === 0) {
    console.error('Nothing to import.');
    process.exit(1);
  }

  if (dryRun) {
    console.log('[dry-run] Would upsert:');
    valid.forEach((r) =>
      console.log(
        `  ${r.code}  ${r.discount_type} ${r.discount_amount}  applies_to=${r.applies_to}  expires=${r.expires_at || 'never'}`
      )
    );
    return;
  }

  const { data, error } = await supabase
    .from('groupon_codes')
    .upsert(valid, { onConflict: 'code', ignoreDuplicates: false })
    .select('code');
  if (error) {
    throw new Error(error.message || 'Upsert failed');
  }
  console.log(`[ok] Imported/updated ${Array.isArray(data) ? data.length : valid.length} code(s).`);
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
