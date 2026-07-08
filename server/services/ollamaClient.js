/**
 * Reusable Ollama adapter: timeouts, retries, generation options, optional quality validation.
 * Used by rocket advisories, Captain Bobby, and (via mirrored Python client) Captain's Log.
 */

const fetch = require('node-fetch');
const { validateAiOutput } = require('./aiOutputQuality');

function trimTrailingSlash(url) {
  return String(url || '').replace(/\/$/, '');
}

function resolveOllamaBaseUrl() {
  const raw = String(process.env.OLLAMA_URL || 'http://127.0.0.1:11434').trim();
  if (!raw) return 'http://127.0.0.1:11434';
  const cleaned = raw.replace(/\/api\/generate\/?$/i, '').replace(/\/api\/chat\/?$/i, '');
  return trimTrailingSlash(cleaned);
}

function resolveModel() {
  return (
    String(process.env.CAPTAIN_BOBBY_MODEL || process.env.OLLAMA_MODEL || 'llama3.1:8b').trim() ||
    'llama3.1:8b'
  );
}

function resolveTimeoutMs(override) {
  if (Number.isFinite(Number(override)) && Number(override) > 0) return Number(override);
  const fromEnv = Number(process.env.OLLAMA_TIMEOUT_MS || process.env.OLLAMA_TIMEOUT_SEC * 1000 || 90000);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 90000;
}

function resolveNumPredict(override) {
  if (Number.isFinite(Number(override)) && Number(override) > 0) return Math.floor(Number(override));
  const bobby = Number(process.env.CAPTAIN_BOBBY_MAX_TOKENS || 0);
  const shared = Number(process.env.OLLAMA_NUM_PREDICT || 0);
  const chosen = bobby > 0 ? bobby : shared;
  return chosen > 0 ? Math.floor(chosen) : 800;
}

function resolveTemperature(override) {
  if (Number.isFinite(Number(override))) return Math.max(0.05, Math.min(1, Number(override)));
  const raw = Number(process.env.OLLAMA_TEMPERATURE || 0.2);
  return Number.isFinite(raw) ? Math.max(0.05, Math.min(0.95, raw)) : 0.2;
}

function isEnabled() {
  return String(process.env.CAPTAIN_BOBBY_ENABLED || '1').trim() !== '0';
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {object} params
 * @param {string} params.prompt
 * @param {string} [params.system]
 * @param {string} [params.model]
 * @param {number} [params.temperature]
 * @param {number} [params.numPredict]
 * @param {number} [params.timeoutMs]
 * @param {string} [params.format] json | undefined
 * @param {boolean} [params.stream=false]
 * @returns {Promise<{ ok: boolean, text: string, error?: string, raw?: unknown }>}
 */
async function generateText(params = {}) {
  if (!isEnabled()) {
    return { ok: false, text: '', error: 'ollama_disabled' };
  }

  const base = resolveOllamaBaseUrl();
  const url = `${base}/api/generate`;
  const model = params.model || resolveModel();
  const timeoutMs = resolveTimeoutMs(params.timeoutMs);
  const body = {
    model,
    prompt: String(params.prompt || ''),
    stream: Boolean(params.stream),
    options: {
      temperature: resolveTemperature(params.temperature),
      top_p: Number(process.env.OLLAMA_TOP_P || 0.85),
      num_predict: resolveNumPredict(params.numPredict),
    },
  };
  if (params.system) {
    body.system = String(params.system);
  }
  if (params.format === 'json') {
    body.format = 'json';
  }

  try {
    const response = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      timeoutMs
    );
    const rawText = await response.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      return { ok: false, text: '', error: 'invalid_json', raw: rawText.slice(0, 240) };
    }
    if (!response.ok) {
      return { ok: false, text: '', error: `http_${response.status}`, raw: data };
    }
    const text = typeof data.response === 'string' ? data.response.trim() : '';
    if (!text) {
      return { ok: false, text: '', error: 'empty_response', raw: data };
    }
    return { ok: true, text, raw: data };
  } catch (err) {
    const message = err?.name === 'AbortError' ? 'timeout' : err?.message || 'request_failed';
    return { ok: false, text: '', error: message };
  }
}

/**
 * Chat-style generation for Captain Bobby.
 * @param {object} params
 * @param {Array<{role: string, content: string}>} params.messages
 * @param {string} [params.system]
 */
async function generateChat(params = {}) {
  if (!isEnabled()) {
    return { ok: false, text: '', error: 'ollama_disabled' };
  }

  const base = resolveOllamaBaseUrl();
  const url = `${base}/api/chat`;
  const model = params.model || resolveModel();
  const timeoutMs = resolveTimeoutMs(params.timeoutMs);
  const messages = Array.isArray(params.messages) ? params.messages : [];
  const chatMessages = params.system
    ? [{ role: 'system', content: String(params.system) }, ...messages]
    : messages;

  const body = {
    model,
    messages: chatMessages,
    stream: false,
    options: {
      temperature: resolveTemperature(params.temperature),
      top_p: Number(process.env.OLLAMA_TOP_P || 0.85),
      num_predict: resolveNumPredict(params.numPredict),
    },
  };
  if (params.format === 'json') {
    body.format = 'json';
  }

  try {
    const response = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      timeoutMs
    );
    const rawText = await response.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      return { ok: false, text: '', error: 'invalid_json', raw: rawText.slice(0, 240) };
    }
    if (!response.ok) {
      return { ok: false, text: '', error: `http_${response.status}`, raw: data };
    }
    const text =
      typeof data.message?.content === 'string'
        ? data.message.content.trim()
        : typeof data.response === 'string'
          ? data.response.trim()
          : '';
    if (!text) {
      return { ok: false, text: '', error: 'empty_response', raw: data };
    }
    return { ok: true, text, raw: data };
  } catch (err) {
    const message = err?.name === 'AbortError' ? 'timeout' : err?.message || 'request_failed';
    return { ok: false, text: '', error: message };
  }
}

/**
 * Generate with one quality-validated retry using a stricter temperature.
 * @param {object} params
 * @param {object} [params.quality]
 */
async function generateValidated(params = {}) {
  const quality = params.quality || {};
  const first = await generateText(params);
  if (!first.ok) return first;

  let check = validateAiOutput(first.text, quality);
  if (check.ok) {
    return { ...first, quality: check.meta };
  }

  const retryPrompt = `${String(params.prompt || '')}\n\nSTRICT RETRY: Be concise, factual, and avoid repeating the headline. No placeholder phrases.`;
  const retry = await generateText({
    ...params,
    prompt: retryPrompt,
    temperature: Math.max(0.05, resolveTemperature(params.temperature) - 0.08),
  });
  if (!retry.ok) {
    return { ...first, qualityRejected: true, qualityReason: check.reason, qualityMeta: check.meta };
  }

  check = validateAiOutput(retry.text, quality);
  if (check.ok) {
    return { ...retry, retried: true, quality: check.meta };
  }

  return {
    ok: false,
    text: '',
    error: check.reason || 'quality_rejected',
    qualityMeta: check.meta,
    firstAttempt: first.text.slice(0, 400),
    secondAttempt: retry.text.slice(0, 400),
  };
}

module.exports = {
  generateText,
  generateChat,
  generateValidated,
  resolveOllamaBaseUrl,
  resolveModel,
  resolveTimeoutMs,
  resolveNumPredict,
  resolveTemperature,
  isEnabled,
};
