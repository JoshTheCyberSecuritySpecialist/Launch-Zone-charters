/**
 * Server-side Supabase client (service role).
 *
 * Default Node fetch (undici) often uses a short connect timeout (~10s) to *.supabase.co,
 * which fails on slow Wi‑Fi / DNS. We use `node-fetch` (already a server dependency) with
 * a longer request timeout and keep-alive agents. Tune with SUPABASE_FETCH_TIMEOUT_MS.
 */
const http = require('http');
const https = require('https');
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const bodyMs = Number(process.env.SUPABASE_BODY_TIMEOUT_MS || 120000);
const fetchTimeoutMs = Number(process.env.SUPABASE_FETCH_TIMEOUT_MS || 90000);

const httpsAgent = new https.Agent({
  keepAlive: true,
  timeout: bodyMs,
});

const httpAgent = new http.Agent({
  keepAlive: true,
  timeout: bodyMs,
});

function supabaseFetch(url, options = {}) {
  const u = typeof url === 'string' ? url : String(url);
  let parsed;
  try {
    parsed = new URL(u);
  } catch {
    return fetch(u, { ...options, timeout: fetchTimeoutMs });
  }
  const agent = parsed.protocol === 'https:' ? httpsAgent : httpAgent;
  return fetch(u, {
    ...options,
    agent,
    timeout: fetchTimeoutMs,
  });
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  global: { fetch: supabaseFetch },
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

module.exports = supabase;
