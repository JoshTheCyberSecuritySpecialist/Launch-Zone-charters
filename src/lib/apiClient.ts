import { env } from '../config/env.js';

const API_BASE_URL = env.apiUrl;

const pendingRequests = new Map<string, Promise<unknown>>();
const cache = new Map<string, { data: unknown; timestamp: number }>();

const CACHE_TTL = 30 * 1000;

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

  const request = fetch(url, {
    method: 'GET',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
    .then(async (res) => {
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`API GET failed: ${res.status} ${url} ${text}`);
      }
      const data = (await res.json()) as T;
      if (!options.skipCache) {
        cache.set(cacheKey, { data, timestamp: Date.now() });
      }
      return data;
    })
    .finally(() => {
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
