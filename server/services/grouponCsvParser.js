/**
 * Groupon CSV parsing by header name with alias support.
 */
const {
  normalizeHeaderName,
  normalizeVoucherNumber,
  normalizeOwnerName,
  parseGrouponDateTime,
  parseCurrencyToCents,
  normalizeRedeemedFlag,
} = require('./grouponVoucherUtils');

const MAX_CSV_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 10000;

const HEADER_ALIASES = {
  voucher_number: ['groupon no', 'groupon number', 'voucher number', 'groupon no '],
  merchant_reference_id: ['merchant reference id', 'merchant reference'],
  owner_name: ["owner s name", 'owners name', 'owner name'],
  purchased_at: ['purchased at', 'purchase date'],
  expires: ['expires', 'expiration date', 'expires at'],
  viewed_at: ['viewed at'],
  viewed: ['viewed'],
  payable_event: ['payable event'],
  deal: ['deal', 'deal name'],
  deal_permalink: ['deal permalink'],
  deal_launched_at: ['deal launched at'],
  option_name: ['option name'],
  divisions: ['divisions'],
  status: ['status'],
  redeemed: ['redeemed'],
  redeemed_at: ['redeemed at check in date', 'redeemed at', 'check in date'],
  redeemed_by: ['redeemed by'],
  redemption_location: ['redemption location'],
  refunded_at: ['refunded at'],
  refund_reason: ['refund reason'],
  cda: ['cda'],
  notes: ['notes'],
  groupon_price: ['groupon price'],
  sell_price: ['sell price'],
  tax_collected: ['tax collected on merchant s behalf', 'tax collected on merchants behalf', 'tax collected'],
};

function aliasToField(header) {
  const normalized = normalizeHeaderName(header);
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.includes(normalized)) return field;
  }
  return null;
}

function parseCsvRecords(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      field = '';
      if (row.some((cell) => String(cell).trim() !== '')) rows.push(row);
      row = [];
      continue;
    }
    if (ch === '\r') continue;
    field += ch;
  }

  row.push(field);
  if (row.some((cell) => String(cell).trim() !== '')) rows.push(row);

  if (!rows.length) {
    return { headers: [], records: [], headerMap: {}, errors: ['CSV file is empty.'] };
  }

  const headers = rows[0].map((h) => String(h || '').trim());
  const headerMap = {};
  headers.forEach((header, index) => {
    const field = aliasToField(header);
    if (field && headerMap[field] == null) headerMap[field] = index;
  });

  const records = rows.slice(1).map((cells, idx) => {
    const raw = {};
    headers.forEach((header, index) => {
      raw[header] = String(cells[index] ?? '').trim();
    });
    return { rowNumber: idx + 2, raw, cells };
  });

  return { headers, records, headerMap, errors: [] };
}

function getMappedValue(record, headerMap, field) {
  const index = headerMap[field];
  if (index == null) return '';
  return String(record.cells[index] ?? '').trim();
}

function normalizeParsedRow(record, headerMap) {
  const errors = [];
  const voucherRaw = getMappedValue(record, headerMap, 'voucher_number');
  const normalizedVoucher = normalizeVoucherNumber(voucherRaw);
  if (!normalizedVoucher) errors.push('Missing Groupon voucher number.');
  if (normalizedVoucher && normalizedVoucher.length < 8) errors.push('Voucher number looks invalid.');

  const ownerName = normalizeOwnerName(getMappedValue(record, headerMap, 'owner_name'));
  if (!ownerName) errors.push("Missing owner's name.");

  const purchasedAt = parseGrouponDateTime(getMappedValue(record, headerMap, 'purchased_at'));
  const expiresAt = parseGrouponDateTime(getMappedValue(record, headerMap, 'expires'));
  const redeemedAt = parseGrouponDateTime(getMappedValue(record, headerMap, 'redeemed_at'));
  const refundedAt = parseGrouponDateTime(getMappedValue(record, headerMap, 'refunded_at'));

  if (getMappedValue(record, headerMap, 'purchased_at') && !purchasedAt) {
    errors.push('Invalid purchased-at date format.');
  }
  if (getMappedValue(record, headerMap, 'expires') && !expiresAt) {
    errors.push('Invalid expiration date format.');
  }

  const grouponPriceCents = parseCurrencyToCents(getMappedValue(record, headerMap, 'groupon_price'));
  const sellPriceCents = parseCurrencyToCents(getMappedValue(record, headerMap, 'sell_price'));

  return {
    rowNumber: record.rowNumber,
    errors,
    data: {
      voucher_number: normalizedVoucher,
      merchant_reference_id: getMappedValue(record, headerMap, 'merchant_reference_id') || null,
      owner_name: ownerName || null,
      purchased_at: purchasedAt,
      expires_at: expiresAt,
      source_status: getMappedValue(record, headerMap, 'status') || null,
      payable_event: getMappedValue(record, headerMap, 'payable_event') || null,
      redeemed_flag: normalizeRedeemedFlag(getMappedValue(record, headerMap, 'redeemed')) || null,
      redeemed_at: redeemedAt,
      redeemed_by: getMappedValue(record, headerMap, 'redeemed_by') || null,
      refunded_at: refundedAt,
      refund_reason: getMappedValue(record, headerMap, 'refund_reason') || null,
      deal_name: getMappedValue(record, headerMap, 'deal') || null,
      deal_permalink: getMappedValue(record, headerMap, 'deal_permalink') || null,
      option_name: getMappedValue(record, headerMap, 'option_name') || null,
      divisions: getMappedValue(record, headerMap, 'divisions') || null,
      cda: getMappedValue(record, headerMap, 'cda') || null,
      notes: getMappedValue(record, headerMap, 'notes') || null,
      groupon_price_cents: grouponPriceCents,
      sell_price_cents: sellPriceCents,
    },
  };
}

function validateCsvInput({ csvText, byteLength }) {
  const errors = [];
  if (!csvText || !String(csvText).trim()) errors.push('CSV content is required.');
  if (byteLength > MAX_CSV_BYTES) errors.push('CSV file exceeds the 5 MB limit.');
  const sample = String(csvText || '').slice(0, 4096);
  if (/\0/.test(sample)) errors.push('File appears to be binary, not CSV.');
  return errors;
}

function parseGrouponCsv(csvText) {
  const byteLength = Buffer.byteLength(String(csvText || ''), 'utf8');
  const inputErrors = validateCsvInput({ csvText, byteLength });
  if (inputErrors.length) {
    return { ok: false, errors: inputErrors, headers: [], rows: [], headerMap: {} };
  }

  const parsed = parseCsvRecords(String(csvText).replace(/^\uFEFF/, ''));
  if (parsed.errors.length) return { ok: false, errors: parsed.errors, headers: [], rows: [], headerMap: {} };
  if (parsed.headerMap.voucher_number == null) {
    return {
      ok: false,
      errors: ['Missing required column: Groupon No.'],
      headers: parsed.headers,
      rows: [],
      headerMap: parsed.headerMap,
    };
  }
  if (parsed.records.length > MAX_ROWS) {
    return {
      ok: false,
      errors: [`CSV exceeds ${MAX_ROWS} row limit.`],
      headers: parsed.headers,
      rows: [],
      headerMap: parsed.headerMap,
    };
  }

  const rows = parsed.records.map((record) => normalizeParsedRow(record, parsed.headerMap));
  return {
    ok: true,
    errors: [],
    headers: parsed.headers,
    headerMap: parsed.headerMap,
    rows,
  };
}

module.exports = {
  MAX_CSV_BYTES,
  HEADER_ALIASES,
  aliasToField,
  parseGrouponCsv,
  parseCsvRecords,
  normalizeParsedRow,
};
