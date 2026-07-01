/**
 * Ensure client-supplied document URLs point to this project's Supabase Storage only.
 */

function supabaseProjectRef() {
  const url = (process.env.SUPABASE_URL || '').trim();
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    const m = host.match(/^([a-z0-9]+)\.supabase\.co$/i);
    return m ? m[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param {string | null | undefined} rawUrl
 * @param {object} [opts]
 * @param {string} [opts.expectedPrefix] - e.g. "licenses/uuid/" or "documents/licenses/uuid/"
 * @returns {{ ok: true, url: string } | { ok: false, reason: string }}
 */
function validateStorageDocumentUrl(rawUrl, opts = {}) {
  const urlStr = String(rawUrl || '').trim();
  if (!urlStr) return { ok: false, reason: 'empty' };

  let parsed;
  try {
    parsed = new URL(urlStr);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, reason: 'https_required' };
  }

  const ref = supabaseProjectRef();
  if (!ref) return { ok: false, reason: 'no_project_ref' };

  const allowedHosts = [
    `${ref}.supabase.co`,
    `${ref}.supabase.in`,
  ];
  const host = parsed.hostname.toLowerCase();
  if (!allowedHosts.includes(host)) {
    return { ok: false, reason: 'host_not_allowed' };
  }

  const path = decodeURIComponent(parsed.pathname);
  const storageMatch = path.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/i);
  if (!storageMatch) {
    return { ok: false, reason: 'not_storage_object' };
  }

  const bucket = storageMatch[1];
  const objectPath = storageMatch[2];
  const allowedBuckets = new Set(['documents', 'licenses']);
  if (!allowedBuckets.has(bucket)) {
    return { ok: false, reason: 'bucket_not_allowed' };
  }

  if (opts.expectedPrefix) {
    const prefix = String(opts.expectedPrefix).replace(/^\/+/, '');
    if (!objectPath.startsWith(prefix)) {
      return { ok: false, reason: 'path_prefix_mismatch' };
    }
  }

  return { ok: true, url: urlStr, bucket, objectPath };
}

/**
 * @param {string} rawUrl
 * @param {object} [opts]
 * @param {string} [opts.bookingId]
 * @param {string} [opts.preTripPrefix] - e.g. pre-trip/draft-uuid
 */
function validateCustomerDocumentUrl(rawUrl, opts = {}) {
  const base = validateStorageDocumentUrl(rawUrl);
  if (!base.ok) return base;

  const { bucket, objectPath } = base;
  const bookingId = opts.bookingId ? String(opts.bookingId).trim() : '';
  const preTripPrefix = opts.preTripPrefix ? String(opts.preTripPrefix).trim() : '';

  if (bucket === 'licenses' && bookingId) {
    if (objectPath.startsWith(`${bookingId}/`)) return base;
    return { ok: false, reason: 'path_prefix_mismatch' };
  }

  if (bucket === 'documents') {
    if (preTripPrefix) {
      if (
        objectPath.startsWith(`licenses/${preTripPrefix}/`) ||
        objectPath.startsWith(`insurance/${preTripPrefix}/`)
      ) {
        return base;
      }
    }
    if (bookingId) {
      if (
        objectPath.startsWith(`licenses/${bookingId}/`) ||
        objectPath.startsWith(`insurance/${bookingId}/`)
      ) {
        return base;
      }
    }
    if (objectPath.startsWith('licenses/pre-trip/') || objectPath.startsWith('insurance/pre-trip/')) {
      return base;
    }
  }

  return { ok: false, reason: 'path_prefix_mismatch' };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = {
  validateStorageDocumentUrl,
  validateCustomerDocumentUrl,
  supabaseProjectRef,
  escapeHtml,
};
