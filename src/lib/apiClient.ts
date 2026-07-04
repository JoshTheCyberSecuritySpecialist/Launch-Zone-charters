import { env } from '../config/env.js';
import { adminDebugLog } from './adminDiagnostics';

const API_BASE_URL = env.apiUrl;

const pendingRequests = new Map<string, Promise<unknown>>();
const cache = new Map<string, { data: unknown; timestamp: number }>();

const CACHE_TTL = 30 * 1000;
const API_TIMEOUT_MS = 15000;

function buildUrl(path: string): string {
  if (path.startsWith('http')) return path;
  return `${API_BASE_URL}${path}`;
}

type ApiGetOptions = {
  skipCache?: boolean;
  headers?: HeadersInit;
};

export async function apiGet<T = unknown>(path: string, options: ApiGetOptions = {}): Promise<T> {
  if (!API_BASE_URL) {
    throw new Error('API URL is not configured (set VITE_API_URL).');
  }
  const url = buildUrl(path);
  const cacheKey = url;
  const now = Date.now();

  const cached = cache.get(cacheKey);
  if (!options.skipCache && cached && now - cached.timestamp < CACHE_TTL) {
    return cached.data as T;
  }

  if (pendingRequests.has(cacheKey)) {
    return pendingRequests.get(cacheKey) as Promise<T>;
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  const startedAt = performance.now();
  adminDebugLog('api:get:start', { url });

  const request = fetch(url, {
    method: 'GET',
    credentials: 'include',
    signal: controller.signal,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
    .then(async (res) => {
      const text = await res.text();
      let data: unknown = {};
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = { text: text.slice(0, 240) };
        }
      }
      adminDebugLog('api:get:response', {
        url,
        status: res.status,
        ok: res.ok,
        elapsedMs: Math.round(performance.now() - startedAt),
        body: data,
      });
      if (!res.ok) {
        throw new Error(`API GET failed: ${res.status} ${url} ${text}`);
      }
      if (!options.skipCache) {
        cache.set(cacheKey, { data, timestamp: Date.now() });
      }
      return data as T;
    })
    .catch((err) => {
      const message = err instanceof DOMException && err.name === 'AbortError'
        ? `API GET timed out after ${Math.round(API_TIMEOUT_MS / 1000)}s: ${url}`
        : err instanceof Error
          ? err.message
          : 'API GET failed.';
      adminDebugLog('api:get:error', { url, message });
      throw new Error(message);
    })
    .finally(() => {
      window.clearTimeout(timeout);
      pendingRequests.delete(cacheKey);
    });

  pendingRequests.set(cacheKey, request as Promise<unknown>);
  return request as Promise<T>;
}

export function clearApiCache(path?: string) {
  if (!path) {
    cache.clear();
    return;
  }
  cache.delete(buildUrl(path));
}

export function clearPendingRequests() {
  pendingRequests.clear();
}
