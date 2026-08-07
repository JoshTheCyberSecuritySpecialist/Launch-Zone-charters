const DEFAULT_TIMEOUT_MS = 15000;

export const ADMIN_DEBUG =
  import.meta.env.DEV ||
  ['1', 'true', 'yes', 'on'].includes(String(import.meta.env.VITE_ADMIN_DEBUG || '').trim().toLowerCase());

function summarize(value: unknown) {
  if (value == null) return value;
  if (typeof value === 'string') return value.slice(0, 240);
  if (Array.isArray(value)) return { type: 'array', length: value.length };
  if (typeof value === 'object') {
    return {
      type: 'object',
      keys: Object.keys(value as Record<string, unknown>).slice(0, 12),
    };
  }
  return value;
}

export function adminDebugLog(label: string, payload: Record<string, unknown> = {}) {
  if (!ADMIN_DEBUG) return;
  console.log(`[admin-debug] ${label}`, Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, summarize(value)])));
}

export function describeError(err: unknown, fallback = 'Request failed.') {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err.trim()) return err;
  return fallback;
}

export async function withTimeout<T>(label: string, promise: PromiseLike<T>, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  let timer: number | undefined;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
}

export async function fetchJsonWithTimeout<T = unknown>(
  label: string,
  url: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  const outerSignal = init.signal;
  const onOuterAbort = () => controller.abort();
  if (outerSignal) {
    if (outerSignal.aborted) controller.abort();
    else outerSignal.addEventListener('abort', onOuterAbort, { once: true });
  }
  const startedAt = performance.now();
  adminDebugLog(`${label}:start`, { url, method: init.method || 'GET' });
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    let payload: unknown = {};
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { text: text.slice(0, 240) };
      }
    }
    adminDebugLog(`${label}:response`, {
      status: res.status,
      ok: res.ok,
      elapsedMs: Math.round(performance.now() - startedAt),
      body: payload,
    });
    if (!res.ok) {
      const message =
        payload && typeof payload === 'object' && 'error' in payload && typeof (payload as { error?: unknown }).error === 'string'
          ? (payload as { error: string }).error
          : `Request failed with status ${res.status}.`;
      throw new Error(message);
    }
    return payload as T;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      adminDebugLog(`${label}:aborted`, {});
      throw err;
    }
    const message = err instanceof DOMException && err.name === 'AbortError'
      ? `${label} timed out after ${Math.round(timeoutMs / 1000)}s`
      : describeError(err);
    adminDebugLog(`${label}:error`, { message });
    throw new Error(message);
  } finally {
    if (outerSignal) outerSignal.removeEventListener('abort', onOuterAbort);
    window.clearTimeout(timer);
  }
}
