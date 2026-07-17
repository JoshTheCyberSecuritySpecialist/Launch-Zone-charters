const path = require('path');
const documentUrlValidation = require('./documentUrlValidation');

const ALLOWED_DOCUMENTS = new Set(['license', 'insurance', 'buoy_proof']);
const ALLOWED_CONTEXTS = new Set(['pre_trip', 'booking']);

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);
const PDF_EXT = new Set(['pdf']);

function cleanDocumentKind(raw) {
  const kind = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');
  return ALLOWED_DOCUMENTS.has(kind) ? kind : null;
}

function safeFileName(value, fallback = 'file') {
  const cleaned = String(value || fallback)
    .replace(/[\r\n"]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return cleaned || fallback;
}

function isRecordUuid(id) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || '').trim());
}

function cleanContext(raw) {
  const ctx = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');
  return ALLOWED_CONTEXTS.has(ctx) ? ctx : null;
}

function extensionFromObjectPath(objectPath) {
  const ext = path.extname(String(objectPath || '')).replace(/^\./, '').toLowerCase();
  return ext || 'bin';
}

function mimeFromExtension(ext) {
  switch (String(ext || '').toLowerCase()) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'pdf':
      return 'application/pdf';
    default:
      return 'application/octet-stream';
  }
}

function viewModeFromMime(mimeType) {
  const mime = String(mimeType || '').toLowerCase();
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('image/')) return 'image';
  return 'unsupported';
}

function fileNameFromObjectPath(objectPath, label) {
  const base = path.basename(String(objectPath || ''));
  if (base && base !== '.' && base !== '..') return base;
  return `${String(label || 'document').replace(/\s+/g, '-').toLowerCase()}.bin`;
}

function validateResolvedStorageUrl(rawUrl, opts = {}) {
  const bookingId = opts.bookingId ? String(opts.bookingId).trim() : '';
  const preTripPrefix = opts.preTripPrefix ? String(opts.preTripPrefix).trim() : '';

  if (bookingId) {
    return documentUrlValidation.validateCustomerDocumentUrl(rawUrl, { bookingId });
  }
  if (preTripPrefix) {
    return documentUrlValidation.validateCustomerDocumentUrl(rawUrl, { preTripPrefix });
  }
  return documentUrlValidation.validateCustomerDocumentUrl(rawUrl, {
    allowUnscopedPreTrip: Boolean(opts.allowUnscopedPreTrip),
  });
}

async function resolvePreTripDocument(supabase, submissionId, documentKind) {
  const { data, error } = await supabase
    .from('pre_trip_submissions')
    .select('id, license_url, insurance_url, idempotency_key')
    .eq('id', submissionId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) {
    const err = new Error('Submission not found.');
    err.statusCode = 404;
    throw err;
  }

  const rawUrl =
    documentKind === 'license'
      ? data.license_url
      : documentKind === 'insurance'
        ? data.insurance_url
        : null;
  const url = String(rawUrl || '').trim();
  if (!url) {
    const err = new Error('Document not uploaded for this submission.');
    err.statusCode = 404;
    throw err;
  }

  const preTripPrefix = data.idempotency_key ? `pre-trip/${data.idempotency_key}` : '';
  const check = validateResolvedStorageUrl(url, {
    preTripPrefix: preTripPrefix || undefined,
    allowUnscopedPreTrip: !preTripPrefix,
  });
  if (!check.ok) {
    const err = new Error('Stored document URL is invalid or inaccessible.');
    err.statusCode = 400;
    throw err;
  }

  return {
    context: 'pre_trip',
    recordId: submissionId,
    documentKind,
    bucket: check.bucket,
    objectPath: check.objectPath,
    sourceUrl: url,
  };
}

async function resolveBookingDocument(supabase, bookingId, documentKind) {
  const { data: booking, error } = await supabase
    .from('bookings')
    .select('id, license_url, insurance_url, customers(id_document_url, insurance_proof_url), user_verifications(buoy_proof_url)')
    .eq('id', bookingId)
    .maybeSingle();
  if (error) throw error;
  if (!booking?.id) {
    const err = new Error('Booking not found.');
    err.statusCode = 404;
    throw err;
  }

  const customer = Array.isArray(booking.customers) ? booking.customers[0] : booking.customers;
  const verification = Array.isArray(booking.user_verifications)
    ? booking.user_verifications[0]
    : booking.user_verifications;

  let rawUrl = null;
  if (documentKind === 'license') {
    rawUrl = booking.license_url || customer?.id_document_url;
  } else if (documentKind === 'insurance') {
    rawUrl = booking.insurance_url || customer?.insurance_proof_url;
  } else if (documentKind === 'buoy_proof') {
    rawUrl = verification?.buoy_proof_url;
  }

  const url = String(rawUrl || '').trim();
  if (!url) {
    const err = new Error('Document not uploaded for this booking.');
    err.statusCode = 404;
    throw err;
  }

  const check = validateResolvedStorageUrl(url, { bookingId });
  if (!check.ok) {
    const err = new Error('Stored document URL is invalid or inaccessible.');
    err.statusCode = 400;
    throw err;
  }

  return {
    context: 'booking',
    recordId: bookingId,
    documentKind,
    bucket: check.bucket,
    objectPath: check.objectPath,
    sourceUrl: url,
  };
}

async function resolveAdminDocument(supabase, { context, recordId, document }) {
  const ctx = cleanContext(context);
  const documentKind = cleanDocumentKind(document);
  const id = String(recordId || '').trim();

  if (!ctx || !documentKind || !id) {
    const err = new Error('context, recordId, and document are required.');
    err.statusCode = 400;
    throw err;
  }
  if (!isRecordUuid(id)) {
    const err = new Error('Invalid record id.');
    err.statusCode = 400;
    throw err;
  }
  if (documentKind === 'buoy_proof' && ctx !== 'booking') {
    const err = new Error('buoy_proof is only available for booking context.');
    err.statusCode = 400;
    throw err;
  }

  if (ctx === 'pre_trip') {
    return resolvePreTripDocument(supabase, id, documentKind);
  }
  return resolveBookingDocument(supabase, id, documentKind);
}

function buildDocumentMeta(resolved, { expiresInSeconds = 3600 } = {}) {
  const ext = extensionFromObjectPath(resolved.objectPath);
  const mimeType = mimeFromExtension(ext);
  const viewMode = viewModeFromMime(mimeType);
  const fileName = fileNameFromObjectPath(resolved.objectPath, resolved.documentKind);
  return {
    context: resolved.context,
    recordId: resolved.recordId,
    document: resolved.documentKind,
    mimeType,
    viewMode,
    fileName,
    expiresInSeconds,
  };
}

async function createSignedAccess(supabase, resolved, expiresInSeconds = 3600) {
  const { data, error } = await supabase.storage
    .from(resolved.bucket)
    .createSignedUrl(resolved.objectPath, expiresInSeconds);
  if (error || !data?.signedUrl) {
    const err = new Error(error?.message || 'Could not create signed document URL.');
    err.statusCode = 500;
    throw err;
  }
  return {
    ...buildDocumentMeta(resolved, { expiresInSeconds }),
    signedUrl: data.signedUrl,
  };
}

async function downloadDocumentBuffer(supabase, resolved) {
  const { data, error } = await supabase.storage.from(resolved.bucket).download(resolved.objectPath);
  if (error || !data) {
    const err = new Error(error?.message || 'Could not download document.');
    err.statusCode = 404;
    throw err;
  }
  const buffer = Buffer.from(await data.arrayBuffer());
  if (!buffer.length) {
    const err = new Error('Document file is empty.');
    err.statusCode = 404;
    throw err;
  }
  const meta = buildDocumentMeta(resolved);
  return { buffer, ...meta };
}

module.exports = {
  ALLOWED_DOCUMENTS,
  ALLOWED_CONTEXTS,
  cleanContext,
  cleanDocumentKind,
  isRecordUuid,
  safeContentDispositionFilename: safeFileName,
  extensionFromObjectPath,
  mimeFromExtension,
  viewModeFromMime,
  fileNameFromObjectPath,
  resolveAdminDocument,
  createSignedAccess,
  downloadDocumentBuffer,
};
