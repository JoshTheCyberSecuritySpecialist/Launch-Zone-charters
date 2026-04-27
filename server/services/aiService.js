/**
 * Ollama local LLM — Node callers only (e.g. rocket advisory). Captain's Log heavy AI runs in Python (ai-content).
 */

const fetch = require('node-fetch');

const OLLAMA_BASE = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const OLLAMA_MODEL = (process.env.OLLAMA_MODEL || 'mistral').trim();

const OLLAMA_NODE_WINDOW_MS = Math.min(
  Math.max(parseInt(process.env.OLLAMA_NODE_WARN_WINDOW_MS || '60000', 10) || 60000, 10000),
  600000
);
const OLLAMA_NODE_WARN_THRESHOLD = Math.min(
  Math.max(parseInt(process.env.OLLAMA_NODE_WARN_THRESHOLD || '8', 10) || 8, 1),
  1000
);

let ollamaNodeCallTimes = [];

function recordNodeOllamaCall() {
  const now = Date.now();
  ollamaNodeCallTimes = ollamaNodeCallTimes.filter((t) => now - t < OLLAMA_NODE_WINDOW_MS);
  ollamaNodeCallTimes.push(now);
  if (ollamaNodeCallTimes.length > OLLAMA_NODE_WARN_THRESHOLD) {
    console.warn(
      '[aiService] WARNING: Ollama invoked often from Node (',
      ollamaNodeCallTimes.length,
      'calls in',
      OLLAMA_NODE_WINDOW_MS / 1000,
      's). Reduce load or stagger requests. Glow does not use Ollama; heavy content AI runs in Python only.'
    );
  }
}

/**
 * @param {string} prompt
 * @returns {Promise<string>}
 */
async function runAI(prompt) {
  recordNodeOllamaCall();
  try {
    console.log('[aiService] Running AI analysis (Node)');

    const url = `${OLLAMA_BASE}/api/generate`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
      }),
    });

    const raw = await response.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch (parseErr) {
      console.error('[aiService] invalid JSON from Ollama', raw.slice(0, 200));
      return 'Unable to generate AI summary';
    }

    if (!response.ok) {
      console.error('[aiService] HTTP', response.status, data);
      return 'Unable to generate AI summary';
    }

    const text = typeof data.response === 'string' ? data.response.trim() : '';
    console.log('[aiService] response length:', text.length);
    if (text) {
      console.log('[aiService] preview:', text.slice(0, 280).replace(/\s+/g, ' '));
    }

    return text || 'Unable to generate AI summary';
  } catch (err) {
    console.error('[aiService]', err?.message || err);
    if (err?.stack) console.error(err.stack);
    return 'Unable to generate AI summary';
  }
}

module.exports = {
  runAI,
  OLLAMA_BASE,
  OLLAMA_MODEL,
};
