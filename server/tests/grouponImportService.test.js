const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { parseGrouponCsv } = require('../services/grouponCsvParser');
const {
  normalizeVoucherNumber,
  hashVoucherNumber,
  maskVoucherLastFour,
  parseGrouponDateTime,
  parseCurrencyToCents,
  sanitizeCsvExportCell,
} = require('../services/grouponVoucherUtils');
const {
  buildMappingIndex,
  resolveMappingForRow,
} = require('../services/grouponDealMappingService');
const { previewImport } = require('../services/grouponImportService');

const FIXTURE = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'groupon-export-sanitized.csv'),
  'utf8'
);

test('normalizeVoucherNumber trims, uppercases, and removes internal spaces', () => {
  assert.equal(normalizeVoucherNumber(' vs-test-abcd-1234-xy99 '), 'VS-TEST-ABCD-1234-XY99');
});

test('hashVoucherNumber is stable for the same normalized voucher', () => {
  const a = hashVoucherNumber('VS-TEST-AAAA-BBBB-1111');
  const b = hashVoucherNumber('vs-test-aaaa-bbbb-1111');
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{64}$/);
});

test('maskVoucherLastFour never exposes full voucher number', () => {
  assert.equal(maskVoucherLastFour('1111'), '•••• 1111');
});

test('parseGrouponDateTime parses Groupon export datetime format', () => {
  const iso = parseGrouponDateTime('2026-06-27 09:40 AM');
  assert.ok(iso);
  const d = new Date(iso);
  assert.equal(d.getUTCFullYear(), 2026);
  assert.equal(d.getUTCMonth(), 5);
  assert.equal(d.getUTCDate(), 27);
});

test('parseCurrencyToCents stores currency as integer cents', () => {
  assert.equal(parseCurrencyToCents('190'), 19000);
  assert.equal(parseCurrencyToCents('$350.00'), 35000);
});

test('parseGrouponCsv reads sanitized fixture by header name', () => {
  const parsed = parseGrouponCsv(FIXTURE);
  assert.equal(parsed.ok, true);
  assert.ok(parsed.headers.includes('Groupon No.'));
  assert.equal(parsed.rows.length, 8);
  assert.equal(parsed.rows[0].data.voucher_number, 'VS-TEST-AAAA-BBBB-1111');
  assert.equal(parsed.rows[0].data.owner_name, 'Alex Sample');
});

test('parseGrouponCsv rejects missing voucher column', () => {
  const parsed = parseGrouponCsv('Owner\'s Name,Status\nJane Doe,Purchased\n');
  assert.equal(parsed.ok, false);
  assert.match(parsed.errors[0], /Groupon No/i);
});

test('parseGrouponCsv handles reordered columns', () => {
  const csv = "Status,Owner's Name,Groupon No.\nPurchased,Jane Doe,VS-TEST-ZZZZ-YYYY-9999\n";
  const parsed = parseGrouponCsv(csv);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.rows[0].data.voucher_number, 'VS-TEST-ZZZZ-YYYY-9999');
});

test('parseGrouponCsv flags duplicate voucher numbers within one file', () => {
  const preview = previewImport({
    csvText: "Groupon No.,Owner's Name,Status,Redeemed,Deal,Option Name\nVS-DUP-TEST-1234-AAAA,One,Purchased,No,Deal A,Option A\nVS-DUP-TEST-1234-AAAA,Two,Purchased,No,Deal A,Option A\n",
    mappings: [],
  });
  assert.equal(preview.summary.duplicateInFile, 1);
});

test('resolveMappingForRow requires exact normalized deal and option mapping', () => {
  const mappings = [
    {
      id: 'map-1',
      deal_name_normalized: 'captain-led bioluminescence night tour with launch zone charters',
      option_name_normalized: 'bioluminescence night tour for 2 people',
      service_label: 'Bio for 2',
      booking_type: 'charter',
      charter_type: 'bio',
      covered_guest_count: 2,
      active: true,
    },
  ];
  const index = buildMappingIndex(mappings);
  const hit = resolveMappingForRow(
    {
      deal_name: 'Captain-Led Bioluminescence Night Tour with Launch Zone Charters',
      option_name: 'Bioluminescence Night Tour for 2 People',
    },
    index
  );
  assert.ok(hit.mapping);
  const miss = resolveMappingForRow(
    {
      deal_name: 'Captain-Led Bioluminescence Night Tour with Launch Zone Charters',
      option_name: 'Bioluminescence Night Tour for 9 People',
    },
    index
  );
  assert.equal(miss.mapping, null);
});

test('previewImport classifies refunded, redeemed, expired, and unmapped rows', () => {
  const mappings = [
    {
      id: 'bio-1',
      deal_name_normalized: 'captain-led bioluminescence night tour with launch zone charters',
      option_name_normalized: 'bioluminescence night tour for one person',
      service_label: 'Bio for 1',
      booking_type: 'charter',
      charter_type: 'bio',
      covered_guest_count: 1,
      active: true,
    },
    {
      id: 'bio-2',
      deal_name_normalized: 'captain-led bioluminescence night tour with launch zone charters',
      option_name_normalized: 'bioluminescence night tour for 2 people',
      service_label: 'Bio for 2',
      booking_type: 'charter',
      charter_type: 'bio',
      covered_guest_count: 2,
      active: true,
    },
    {
      id: 'bio-4',
      deal_name_normalized: 'captain-led bioluminescence night tour with launch zone charters',
      option_name_normalized: 'bioluminescence night tour for 4 people',
      service_label: 'Bio for 4',
      booking_type: 'charter',
      charter_type: 'bio',
      covered_guest_count: 4,
      active: true,
    },
    {
      id: 'rental-4',
      deal_name_normalized:
        'port orange pontoon rental for up to 6: explore sandbars & disappearing island (up to 20% off)',
      option_name_normalized: '4-hour port orange sandbar pontoon boat rental (up to 6 passengers)',
      service_label: '4hr pontoon',
      booking_type: 'rental',
      rental_type: 'half_day',
      covered_guest_count: 6,
      active: true,
    },
    {
      id: 'rental-8',
      deal_name_normalized:
        'port orange pontoon rental for up to 6: explore sandbars & disappearing island (up to 20% off)',
      option_name_normalized: 'full-day 8-hour port orange pontoon boat rental (up to 6 passengers)',
      service_label: '8hr pontoon',
      booking_type: 'rental',
      rental_type: 'full_day',
      covered_guest_count: 6,
      active: true,
    },
  ];

  const preview = previewImport({ csvText: FIXTURE, mappings });
  assert.equal(preview.ok, true);
  assert.equal(preview.summary.totalRows, 8);
  assert.equal(preview.summary.refundedRows, 1);
  assert.equal(preview.summary.redeemedRows, 1);
  assert.equal(preview.summary.expiredRows, 1);
  assert.equal(preview.summary.unmappedRows, 1);
  assert.ok(preview.rows.every((row) => row.voucherMasked.startsWith('•••• ')));
});

test('sanitizeCsvExportCell protects against spreadsheet formula injection', () => {
  assert.equal(sanitizeCsvExportCell('=2+2'), "'=2+2");
  assert.equal(sanitizeCsvExportCell('+1337'), "'+1337");
});
