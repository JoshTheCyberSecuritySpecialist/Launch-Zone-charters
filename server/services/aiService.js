/**
 * Ollama local LLM — Node callers only (e.g. rocket advisory, Captain Bobby).
 * Captain's Log heavy AI runs in Python (ai-content) via ai-content/ollama_client.py.
 */

const { generateValidated, resolveOllamaBaseUrl, resolveModel } = require('./ollamaClient');

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
      's). Reduce load or stagger requests.'
    );
  }
}

/**
 * @param {string} prompt
 * @param {object} [options]
 * @returns {Promise<string>}
 */
async function runAI(prompt, options = {}) {
  recordNodeOllamaCall();
  console.log('[aiService] Running AI analysis (Node)');

  const result = await generateValidated({
    prompt: String(prompt || ''),
    temperature: options.temperature,
    numPredict: options.numPredict,
    timeoutMs: options.timeoutMs,
    quality: {
      minWords: Number(options.minWords) > 0 ? Number(options.minWords) : 12,
      prompt: String(prompt || ''),
      title: String(options.title || ''),
      ...(options.quality || {}),
    },
  });

  if (result.ok && result.text) {
    console.log('[aiService] response length:', result.text.length);
    console.log('[aiService] preview:', result.text.slice(0, 280).replace(/\s+/g, ' '));
    return result.text;
  }

  console.error('[aiService] generation failed:', result.error, result.qualityReason || '');
  return 'Unable to generate AI summary';
}

module.exports = {
  runAI,
  OLLAMA_BASE: resolveOllamaBaseUrl(),
  OLLAMA_MODEL: resolveModel(),
};
