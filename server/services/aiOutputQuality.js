/**
 * Shared AI output quality guards for Ollama responses (blog summaries, chat, etc.).
 */

const PLACEHOLDER_PATTERNS = [
  /key details are limited/i,
  /use available source details/i,
  /plan conservatively/i,
  /source excerpt unavailable/i,
  /as an ai language model/i,
  /lorem ipsum/i,
  /unable to generate ai summary/i,
  /\[insert/i,
  /todo:/i,
];

const GIBBERISH_PATTERNS = [
  /(.)\1{8,}/, // repeated character runs
  /[^\x00-\x7F]{12,}/, // long non-ascii runs
  /\b(\w{1,3}\s+){12,}\1/i,
];

function wordCount(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function normalizeForCompare(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function longestRepeatedPhrase(text, minWords = 5, minRepeats = 3) {
  const normalized = normalizeForCompare(text);
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length < minWords * minRepeats) return null;

  for (let size = Math.min(12, Math.floor(words.length / minRepeats)); size >= minWords; size -= 1) {
    const counts = new Map();
    for (let i = 0; i <= words.length - size; i += 1) {
      const phrase = words.slice(i, i + size).join(' ');
      counts.set(phrase, (counts.get(phrase) || 0) + 1);
      if (counts.get(phrase) >= minRepeats) return phrase;
    }
  }
  return null;
}

function titleEchoRatio(title, output) {
  const t = normalizeForCompare(title);
  const o = normalizeForCompare(output);
  if (!t || !o) return 0;
  if (o.startsWith(t)) return 1;
  const tWords = new Set(t.split(/\s+/).filter((w) => w.length > 3));
  const oWords = o.split(/\s+/).filter((w) => w.length > 3);
  if (!tWords.size || !oWords.length) return 0;
  let hits = 0;
  for (const w of oWords) {
    if (tWords.has(w)) hits += 1;
  }
  return hits / oWords.length;
}

/**
 * @param {string} output
 * @param {object} [options]
 * @param {number} [options.minWords=20]
 * @param {string} [options.title]
 * @param {string} [options.sourceText]
 * @param {string} [options.prompt]
 * @param {string[]} [options.requiredSections]
 * @param {number} [options.maxTitleEcho=0.72]
 * @returns {{ ok: boolean, reason?: string, meta?: Record<string, unknown> }}
 */
function validateAiOutput(output, options = {}) {
  const text = String(output || '').trim();
  const minWords = Number(options.minWords) > 0 ? Number(options.minWords) : 20;
  const meta = { wordCount: wordCount(text) };

  if (!text) {
    return { ok: false, reason: 'empty_output', meta };
  }

  if (meta.wordCount < minWords) {
    return { ok: false, reason: 'too_short', meta };
  }

  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(text)) {
      return { ok: false, reason: 'placeholder_text', meta: { ...meta, pattern: pattern.source } };
    }
  }

  for (const pattern of GIBBERISH_PATTERNS) {
    if (pattern.test(text)) {
      return { ok: false, reason: 'gibberish_pattern', meta: { ...meta, pattern: pattern.source } };
    }
  }

  const repeated = longestRepeatedPhrase(text);
  if (repeated) {
    return { ok: false, reason: 'repetitive_phrase', meta: { ...meta, repeated } };
  }

  const title = String(options.title || '').trim();
  if (title) {
    const echo = titleEchoRatio(title, text);
    meta.titleEchoRatio = echo;
    const maxEcho = Number(options.maxTitleEcho) > 0 ? Number(options.maxTitleEcho) : 0.72;
    if (echo >= maxEcho && meta.wordCount < Math.max(minWords + 40, 80)) {
      return { ok: false, reason: 'mostly_title_echo', meta };
    }
  }

  const sourceText = String(options.sourceText || '').trim();
  if (sourceText && title) {
    const sourceNorm = normalizeForCompare(`${title}\n${sourceText}`);
    const outNorm = normalizeForCompare(text);
    if (outNorm.length > 40 && sourceNorm.includes(outNorm.slice(0, Math.min(120, outNorm.length)))) {
      const overlap = titleEchoRatio(sourceText, text);
      meta.sourceEchoRatio = overlap;
      if (overlap > 0.55 && meta.wordCount < 120) {
        return { ok: false, reason: 'duplicate_source_text', meta };
      }
    }
  }

  const requiredSections = Array.isArray(options.requiredSections) ? options.requiredSections : [];
  if (requiredSections.length) {
    const lower = text.toLowerCase();
    const missing = requiredSections.filter((s) => !lower.includes(String(s).toLowerCase()));
    if (missing.length) {
      return { ok: false, reason: 'missing_required_sections', meta: { ...meta, missing } };
    }
  }

  const prompt = String(options.prompt || '').trim();
  if (prompt.length > 40) {
    const promptTokens = new Set(
      normalizeForCompare(prompt)
        .split(/\s+/)
        .filter((w) => w.length > 4)
        .slice(0, 40)
    );
    const outTokens = normalizeForCompare(text).split(/\s+/).filter((w) => w.length > 4);
    if (promptTokens.size >= 6 && outTokens.length >= minWords) {
      let hits = 0;
      for (const t of outTokens) {
        if (promptTokens.has(t)) hits += 1;
      }
      const ratio = hits / Math.max(outTokens.length, 1);
      meta.promptTokenOverlap = ratio;
      if (ratio < 0.02 && meta.wordCount < 50) {
        return { ok: false, reason: 'does_not_address_prompt', meta };
      }
    }
  }

  return { ok: true, meta };
}

module.exports = {
  validateAiOutput,
  wordCount,
  normalizeForCompare,
};
