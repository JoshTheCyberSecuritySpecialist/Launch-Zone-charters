/**
 * Groupon deal + option mapping to internal booking services.
 */
const { normalizeDealOrOptionText } = require('./grouponVoucherUtils');

function mappingKey(dealName, optionName) {
  return {
    deal_name_normalized: normalizeDealOrOptionText(dealName),
    option_name_normalized: normalizeDealOrOptionText(optionName),
  };
}

async function loadActiveMappings(supabase) {
  const { data, error } = await supabase
    .from('groupon_deal_option_mappings')
    .select('*')
    .eq('active', true)
    .order('deal_name', { ascending: true });
  if (error) throw new Error(error.message || 'Could not load Groupon deal mappings.');
  return data || [];
}

function buildMappingIndex(mappings) {
  const index = new Map();
  for (const row of mappings) {
    const key = `${row.deal_name_normalized}::${row.option_name_normalized}`;
    index.set(key, row);
  }
  return index;
}

function resolveMappingForRow(row, mappingIndex) {
  const deal = String(row.deal_name || '').trim();
  const option = String(row.option_name || '').trim();
  if (!deal || !option) {
    return { mapping: null, unmappedReason: 'Missing deal or option name.' };
  }
  const key = `${normalizeDealOrOptionText(deal)}::${normalizeDealOrOptionText(option)}`;
  const mapping = mappingIndex.get(key) || null;
  if (!mapping) return { mapping: null, unmappedReason: 'No admin mapping configured for this deal option.' };
  return { mapping, unmappedReason: null };
}

function mappingPayloadFromRequest(body, { partial = false } = {}) {
  const errors = [];
  const payload = {};

  const setText = (key, raw, { required = false } = {}) => {
    if (raw === undefined) {
      if (!partial && required) errors.push(`${key} is required.`);
      return;
    }
    const value = String(raw ?? '').trim();
    if (!value && required) {
      errors.push(`${key} is required.`);
      return;
    }
    payload[key] = value || null;
  };

  setText('deal_name', body.deal_name, { required: true });
  setText('option_name', body.option_name, { required: true });
  if (body.deal_permalink !== undefined) setText('deal_permalink', body.deal_permalink);
  if (body.booking_type !== undefined) {
    const v = String(body.booking_type || '').trim().toLowerCase();
    if (!['rental', 'charter'].includes(v)) errors.push('booking_type must be rental or charter.');
    else payload.booking_type = v;
  }
  if (body.charter_type !== undefined) {
    const v = String(body.charter_type || '').trim().toLowerCase();
    payload.charter_type = v || null;
  }
  if (body.rental_type !== undefined) {
    const v = String(body.rental_type || '').trim().toLowerCase();
    payload.rental_type = v || null;
  }
  if (body.rental_location !== undefined) setText('rental_location', body.rental_location);
  if (body.service_label !== undefined) setText('service_label', body.service_label, { required: !partial });
  if (body.notes !== undefined) setText('notes', body.notes);
  if (body.covered_guest_count !== undefined) {
    const n = Number(body.covered_guest_count);
    if (!Number.isFinite(n) || n < 1) errors.push('covered_guest_count must be at least 1.');
    else payload.covered_guest_count = Math.round(n);
  }
  if (body.active !== undefined) payload.active = Boolean(body.active);

  if (payload.deal_name && payload.option_name) {
    Object.assign(payload, mappingKey(payload.deal_name, payload.option_name));
  }

  return { payload, errors };
}

module.exports = {
  mappingKey,
  loadActiveMappings,
  buildMappingIndex,
  resolveMappingForRow,
  mappingPayloadFromRequest,
};
