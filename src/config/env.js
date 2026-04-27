/** Must match server `PORT` (default 3001 in server.js). Set `VITE_API_URL` in `.env` for production. */
const DEFAULT_API_URL = 'http://localhost:3001';

function trim(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function trimTrailingSlash(s) {
  return s.replace(/\/$/, '').trim();
}

const isProd = import.meta.env.PROD;
const rawApiUrl = trim(import.meta.env.VITE_API_URL ?? '');

/** True when `VITE_API_URL` is set, or in development when using localhost fallback. */
let apiUrlConfigured;
/** Base URL for the Node API (no trailing slash). */
let resolvedApiUrl;

if (rawApiUrl) {
  resolvedApiUrl = trimTrailingSlash(rawApiUrl);
  apiUrlConfigured = true;
} else if (isProd) {
  resolvedApiUrl = '';
  apiUrlConfigured = false;
  console.error(
    '[Launch Zone] VITE_API_URL is required in production. Set it to your API origin (e.g. https://api.yourdomain.com). API-dependent features are disabled.'
  );
} else {
  resolvedApiUrl = trimTrailingSlash(DEFAULT_API_URL);
  apiUrlConfigured = true;
  console.warn('[Launch Zone] VITE_API_URL not set; using dev fallback:', DEFAULT_API_URL);
}

if (import.meta.env.DEV) {
  console.log('API URL:', resolvedApiUrl, '| configured:', apiUrlConfigured);
}

/**
 * Centralized Vite environment values.
 * Define VITE_* variables in `.env` (local) or the hosting provider’s env (production).
 * @type {Readonly<{
 *   supabaseUrl: string;
 *   supabaseAnonKey: string;
 *   apiUrl: string;
 *   apiUrlConfigured: boolean;
 *   contactPhone: string;
 *   businessName: string;
 *   contactEmail: string;
 * }>}
 */
export const env = Object.freeze({
  supabaseUrl: trim(import.meta.env.VITE_SUPABASE_URL),
  supabaseAnonKey: trim(import.meta.env.VITE_SUPABASE_ANON_KEY),
  apiUrl: resolvedApiUrl,
  /** False in production when VITE_API_URL is missing — callers should block API fetches. */
  apiUrlConfigured,
  contactPhone: trim(import.meta.env.VITE_CONTACT_PHONE ?? ''),
  businessName: trim(import.meta.env.VITE_BUSINESS_NAME ?? ''),
  contactEmail: trim(import.meta.env.VITE_CONTACT_EMAIL ?? ''),
});
