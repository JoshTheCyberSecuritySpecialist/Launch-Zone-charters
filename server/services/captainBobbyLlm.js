/**
 * Captain Bobby — Launch Zone virtual first mate (Ollama-only).
 */

const { generateChat, isEnabled } = require('./ollamaClient');
const { validateAiOutput } = require('./aiOutputQuality');

const CAPTAIN_BOBBY_SYSTEM_PROMPT = `You are Captain Bobby, the Launch Zone virtual first mate on launchzonecharters.com.

Personality: funny, warm, helpful, and concise (2–4 short sentences unless the guest asks for detail).

Rules:
- You are NOT a real captain or human staff member.
- Never guarantee weather, rocket launches, dolphins, bioluminescence, refunds, availability, or Groupon validity.
- Do not invent prices, policies, or booking status.
- For booking changes, refunds, or payment issues, offer human handoff (phone 803-542-1761 or /contact).
- Prefer linking guests to site pages (/booking, /pricing, /faqs, /waivers-insurance, /verify) instead of pretending to complete actions.
- If unsure, say so plainly and offer human help.`;

const SAFE_STATIC_FALLBACK =
  "Ahoy — Captain Bobby here. My compass is spinning a bit right now, so I can't give you a solid answer. " +
  'Call Launch Zone at 803-542-1761 or visit /contact and the crew will help you directly.';

/**
 * @param {object} input
 * @param {Array<{role: 'user'|'assistant'|'system', content: string}>} [input.messages]
 * @param {Record<string, unknown>} [input.context]
 * @param {unknown[]} [input.tools] ignored in v1 (reserved)
 * @returns {Promise<{ ok: boolean, text: string, fallback?: boolean, error?: string }>}
 */
async function generateCaptainBobbyReply(input = {}) {
  const messages = Array.isArray(input.messages) ? input.messages : [];
  const context = input.context && typeof input.context === 'object' ? input.context : {};

  if (!isEnabled()) {
    return { ok: true, text: SAFE_STATIC_FALLBACK, fallback: true, error: 'disabled' };
  }

  const contextBlock = Object.keys(context).length
    ? `\n\nPage context:\n${JSON.stringify(context, null, 2)}`
    : '';

  const result = await generateChat({
    system: CAPTAIN_BOBBY_SYSTEM_PROMPT + contextBlock,
    messages,
    temperature: 0.35,
    numPredict: Number(process.env.CAPTAIN_BOBBY_MAX_TOKENS || 800),
  });

  if (!result.ok || !result.text) {
    console.warn('[captainBobbyLlm] Ollama unavailable:', result.error);
    return { ok: true, text: SAFE_STATIC_FALLBACK, fallback: true, error: result.error || 'ollama_failed' };
  }

  const quality = validateAiOutput(result.text, {
    minWords: 6,
    maxTitleEcho: 0.95,
  });

  if (!quality.ok) {
    console.warn('[captainBobbyLlm] quality rejected:', quality.reason, quality.meta);
    return { ok: true, text: SAFE_STATIC_FALLBACK, fallback: true, error: quality.reason };
  }

  return { ok: true, text: result.text.trim(), fallback: false };
}

module.exports = {
  generateCaptainBobbyReply,
  CAPTAIN_BOBBY_SYSTEM_PROMPT,
  SAFE_STATIC_FALLBACK,
};
