const DEFAULT_RETRIES = 2;
const RETRY_DELAY_MS = 450;
const FETCH_TIMEOUT_MS = 45000;

/**
 * Fetch with retries on network failure or non-OK HTTP (limited retries).
 * Uses AbortController timeout per attempt.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  retries = DEFAULT_RETRIES,
  retryDelayMs = RETRY_DELAY_MS
): Promise<Response> {
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        ...init,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.ok) {
        return res;
      }

      if (attempt < retries) {
        console.warn(`[fetchWithRetry] HTTP ${res.status}, retrying (${attempt + 1}/${retries})…`);
        await new Promise((r) => setTimeout(r, retryDelayMs));
        continue;
      }

      return res;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < retries) {
        console.warn('[fetchWithRetry] request failed, retrying…', err);
        await new Promise((r) => setTimeout(r, retryDelayMs));
        continue;
      }
      throw err;
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
