/**
 * Groupon CSV import preview, confirm, and idempotent voucher upsert.
 */
const { parseGrouponCsv } = require('./grouponCsvParser');
const {
  hashVoucherNumber,
  voucherLastFour,
  maskVoucherLastFour,
  normalizeOwnerNameForMatch,
  sanitizeCsvExportCell,
} = require('./grouponVoucherUtils');
const {
  loadActiveMappings,
  buildMappingIndex,
  resolveMappingForRow,
} = require('./grouponDealMappingService');

function classifyImportedRow(row, mapping) {
  const now = Date.now();
  const expiresMs = row.expires_at ? new Date(row.expires_at).getTime() : NaN;
  const status = String(row.source_status || '').trim().toLowerCase();
  const refunded = Boolean(row.refunded_at) || status === 'refunded';
  const redeemed = String(row.redeemed_flag || '').trim().toLowerCase() === 'yes';
  const expired = Number.isFinite(expiresMs) && expiresMs < now;

  let category = 'purchased';
  if (refunded) category = 'refunded';
  else if (redeemed) category = 'redeemed';
  else if (expired) category = 'expired';

  return {
    category,
    mapped: Boolean(mapping),
    unmapped: !mapping,
  };
}

function buildPreviewRow(row, mapping, duplicateInFile) {
  const classification = classifyImportedRow(row.data, mapping);
  return {
    rowNumber: row.rowNumber,
    voucherMasked: maskVoucherLastFour(voucherLastFour(row.data.voucher_number)),
    ownerName: row.data.owner_name,
    dealName: row.data.deal_name,
    optionName: row.data.option_name,
    sourceStatus: row.data.source_status,
    redeemedFlag: row.data.redeemed_flag,
    expiresAt: row.data.expires_at,
    refundedAt: row.data.refunded_at,
    mapped: classification.mapped,
    mappingLabel: mapping?.service_label || null,
    category: classification.category,
    duplicateInFile,
    errors: row.errors,
    valid: row.errors.length === 0,
  };
}

function summarizePreviewRows(rows) {
  const summary = {
    totalRows: rows.length,
    validRows: 0,
    invalidRows: 0,
    duplicateInFile: 0,
    purchasedRows: 0,
    redeemedRows: 0,
    refundedRows: 0,
    expiredRows: 0,
    unmappedRows: 0,
    mappedRows: 0,
  };

  for (const row of rows) {
    if (row.valid) summary.validRows += 1;
    else summary.invalidRows += 1;
    if (row.duplicateInFile) summary.duplicateInFile += 1;
    if (row.category === 'purchased') summary.purchasedRows += 1;
    if (row.category === 'redeemed') summary.redeemedRows += 1;
    if (row.category === 'refunded') summary.refundedRows += 1;
    if (row.category === 'expired') summary.expiredRows += 1;
    if (!row.mapped) summary.unmappedRows += 1;
    if (row.mapped) summary.mappedRows += 1;
  }

  return summary;
}

function previewImport({ csvText, mappings }) {
  const parsed = parseGrouponCsv(csvText);
  if (!parsed.ok) {
    return { ok: false, errors: parsed.errors, headers: parsed.headers, headerMap: parsed.headerMap };
  }

  const mappingIndex = buildMappingIndex(mappings);
  const seenHashes = new Map();
  const previewRows = parsed.rows.map((row) => {
    const voucherHash = row.data.voucher_number ? hashVoucherNumber(row.data.voucher_number) : null;
    let duplicateInFile = false;
    if (voucherHash) {
      if (seenHashes.has(voucherHash)) duplicateInFile = true;
      else seenHashes.set(voucherHash, row.rowNumber);
    }
    const { mapping } = resolveMappingForRow(row.data, mappingIndex);
    const built = buildPreviewRow(row, mapping, duplicateInFile);
    return {
      ...built,
      voucherHash,
      mapping,
      mappingId: mapping?.id || null,
      parsed: row,
    };
  });

  const summary = summarizePreviewRows(previewRows);
  return {
    ok: true,
    errors: [],
    headers: parsed.headers,
    headerMap: parsed.headerMap,
    rows: previewRows,
    summary,
  };
}

function sourceFieldsChanged(existing, incoming) {
  const keys = [
    'source_status',
    'payable_event',
    'redeemed_flag',
    'redeemed_at',
    'redeemed_by',
    'refunded_at',
    'refund_reason',
    'expires_at',
    'deal_name',
    'deal_permalink',
    'option_name',
    'divisions',
    'cda',
    'groupon_price_cents',
    'sell_price_cents',
    'merchant_reference_id',
  ];
  return keys.some((key) => {
    const a = existing[key] ?? null;
    const b = incoming[key] ?? null;
    return String(a) !== String(b);
  });
}

function deriveReviewFlags(existing, incoming, mapping) {
  const flags = [];
  const refunded = Boolean(incoming.refunded_at) || String(incoming.source_status || '').toLowerCase() === 'refunded';
  const redeemed = String(incoming.redeemed_flag || '').toLowerCase() === 'yes';
  if (refunded && existing?.booking_id) flags.push('refunded_linked_booking');
  if (redeemed && !existing?.booking_id) flags.push('redeemed_without_booking');
  if (!mapping) flags.push('unmapped_option');
  if (existing?.local_status === 'booked' && sourceFieldsChanged(existing, incoming)) {
    flags.push('source_status_conflict');
  }
  return flags;
}

function voucherRecordFromImport(row, mapping, batchId) {
  const data = row.data;
  return {
    voucher_hash: hashVoucherNumber(data.voucher_number),
    voucher_last_four: voucherLastFour(data.voucher_number),
    owner_name: data.owner_name,
    owner_name_normalized: normalizeOwnerNameForMatch(data.owner_name),
    merchant_reference_id: data.merchant_reference_id,
    purchased_at: data.purchased_at,
    expires_at: data.expires_at,
    source_status: data.source_status,
    payable_event: data.payable_event,
    redeemed_flag: data.redeemed_flag,
    redeemed_at: data.redeemed_at,
    redeemed_by: data.redeemed_by,
    refunded_at: data.refunded_at,
    refund_reason: data.refund_reason,
    deal_name: data.deal_name,
    deal_permalink: data.deal_permalink,
    option_name: data.option_name,
    divisions: data.divisions,
    cda: data.cda,
    groupon_price_cents: data.groupon_price_cents,
    sell_price_cents: data.sell_price_cents,
    mapping_id: mapping?.id || null,
    import_batch_id: batchId,
    last_import_batch_id: batchId,
  };
}

async function recordVoucherEvent(supabase, { voucherId, eventType, actorType = 'system', actorId = null, message, payload = {} }) {
  const { error } = await supabase.from('groupon_voucher_events').insert({
    voucher_id: voucherId,
    event_type: eventType,
    actor_type: actorType,
    actor_id: actorId,
    message,
    payload,
  });
  if (error) throw new Error(error.message || 'Could not record voucher event.');
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const slice = items.slice(i, i + concurrency);
    const batch = await Promise.all(slice.map((item) => worker(item)));
    results.push(...batch);
  }
  return results;
}

async function confirmImport({ supabase, batchId, previewRows, adminUserId }) {
  const counters = {
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    duplicatesInFile: 0,
    unmapped: 0,
  };
  const errorRows = [];
  const validRows = [];

  for (const row of previewRows) {
    if (!row.valid) {
      counters.errors += 1;
      errorRows.push({ rowNumber: row.rowNumber, errors: row.errors });
      continue;
    }
    if (row.duplicateInFile) {
      counters.duplicatesInFile += 1;
      counters.skipped += 1;
      continue;
    }
    validRows.push(row);
    if (!row.mapping) counters.unmapped += 1;
  }

  const existingByHash = new Map();
  const hashes = validRows
    .map((row) => row.voucherHash || (row.parsed?.data?.voucher_number ? hashVoucherNumber(row.parsed.data.voucher_number) : null))
    .filter(Boolean);

  for (const hashChunk of chunkArray(hashes, 100)) {
    const { data, error } = await supabase.from('groupon_vouchers').select('*').in('voucher_hash', hashChunk);
    if (error) throw new Error(error.message || 'Could not look up existing vouchers.');
    for (const row of data || []) existingByHash.set(row.voucher_hash, row);
  }

  const inserts = [];
  const updates = [];

  for (const row of validRows) {
    const incoming = voucherRecordFromImport(row.parsed, row.mapping || null, batchId);
    const existing = existingByHash.get(incoming.voucher_hash);
    if (!existing) {
      const reviewFlags = deriveReviewFlags(null, incoming, row.mapping || null);
      const localStatus =
        incoming.refunded_at || String(incoming.source_status || '').toLowerCase() === 'refunded'
          ? 'cancelled'
          : incoming.expires_at && new Date(incoming.expires_at).getTime() < Date.now()
            ? 'expired'
            : 'available';
      inserts.push({
        row,
        record: {
          ...incoming,
          local_status: localStatus,
          review_flags: reviewFlags,
        },
      });
      continue;
    }

    const update = {
      owner_name: incoming.owner_name,
      owner_name_normalized: incoming.owner_name_normalized,
      purchased_at: incoming.purchased_at,
      expires_at: incoming.expires_at,
      source_status: incoming.source_status,
      payable_event: incoming.payable_event,
      redeemed_flag: incoming.redeemed_flag,
      redeemed_at: incoming.redeemed_at,
      redeemed_by: incoming.redeemed_by,
      refunded_at: incoming.refunded_at,
      refund_reason: incoming.refund_reason,
      deal_name: incoming.deal_name,
      deal_permalink: incoming.deal_permalink,
      option_name: incoming.option_name,
      divisions: incoming.divisions,
      cda: incoming.cda,
      groupon_price_cents: incoming.groupon_price_cents,
      sell_price_cents: incoming.sell_price_cents,
      last_import_batch_id: batchId,
    };
    if (incoming.merchant_reference_id) update.merchant_reference_id = incoming.merchant_reference_id;
    if (row.mapping && !existing.mapping_id) update.mapping_id = row.mapping.id;
    update.review_flags = deriveReviewFlags(existing, { ...existing, ...update }, row.mapping || null);

    const changed = sourceFieldsChanged(existing, update);
    if (!changed && existing.mapping_id) {
      counters.skipped += 1;
      continue;
    }

    updates.push({ row, existing, update });
  }

  const eventRows = [];

  for (const chunk of chunkArray(inserts, 50)) {
    const { data, error } = await supabase
      .from('groupon_vouchers')
      .insert(chunk.map((item) => item.record))
      .select('id, voucher_hash');
    if (error) throw new Error(error.message || 'Could not insert vouchers.');
    counters.inserted += (data || []).length;
    for (const inserted of data || []) {
      const source = chunk.find((item) => item.record.voucher_hash === inserted.voucher_hash);
      if (!source) continue;
      eventRows.push({
        voucher_id: inserted.id,
        event_type: 'imported',
        actor_type: 'admin',
        actor_id: adminUserId,
        message: 'Voucher imported from Groupon CSV.',
        payload: { batchId, rowNumber: source.row.rowNumber },
      });
    }
  }

  await mapWithConcurrency(updates, 10, async ({ row, existing, update }) => {
    const { data: updated, error } = await supabase
      .from('groupon_vouchers')
      .update(update)
      .eq('id', existing.id)
      .select('id')
      .maybeSingle();
    if (error) throw new Error(error.message || 'Could not update voucher.');
    if (updated?.id) {
      counters.updated += 1;
      eventRows.push({
        voucher_id: updated.id,
        event_type: 'import_reconciled',
        actor_type: 'admin',
        actor_id: adminUserId,
        message: 'Voucher updated from repeat Groupon CSV import.',
        payload: { batchId, rowNumber: row.rowNumber, reviewFlags: update.review_flags },
      });
    }
  });

  for (const chunk of chunkArray(eventRows, 100)) {
    const { error } = await supabase.from('groupon_voucher_events').insert(chunk);
    if (error) throw new Error(error.message || 'Could not record voucher import events.');
  }

  const summary = {
    ...counters,
    errorRows,
  };

  const { error: batchError } = await supabase
    .from('groupon_import_batches')
    .update({
      status: 'confirmed',
      inserted_count: counters.inserted,
      updated_count: counters.updated,
      skipped_count: counters.skipped,
      error_count: counters.errors,
      duplicate_in_file_count: counters.duplicatesInFile,
      unmapped_count: counters.unmapped,
      summary,
      confirmed_at: new Date().toISOString(),
    })
    .eq('id', batchId);
  if (batchError) throw new Error(batchError.message || 'Could not finalize import batch.');

  return summary;
}

function buildErrorReportCsv(errorRows) {
  const lines = ['row_number,errors'];
  for (const row of errorRows) {
    const msg = sanitizeCsvExportCell((row.errors || []).join('; '));
    lines.push(`${row.rowNumber},"${msg.replace(/"/g, '""')}"`);
  }
  return `${lines.join('\n')}\n`;
}

function maskVoucherRow(row) {
  return {
    ...row,
    voucher_hash: undefined,
    voucherMasked: maskVoucherLastFour(row.voucher_last_four),
  };
}

module.exports = {
  previewImport,
  confirmImport,
  buildErrorReportCsv,
  maskVoucherRow,
  loadActiveMappings,
  classifyImportedRow,
  recordVoucherEvent,
};
