const test = require('node:test');
const assert = require('node:assert/strict');
const { validateAiOutput } = require('../services/aiOutputQuality');
const { resolveOllamaBaseUrl, resolveModel } = require('../services/ollamaClient');
const { generateCaptainBobbyReply, SAFE_STATIC_FALLBACK } = require('../services/captainBobbyLlm');

test('validateAiOutput rejects placeholder and repetitive text', () => {
  const bad = validateAiOutput('Key details are limited in the current source update.', {
    minWords: 5,
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'placeholder_text');

  const repetitive = validateAiOutput(
    'Rocket launch viewing from the water is useful. Rocket launch viewing from the water is useful. Rocket launch viewing from the water is useful.',
    { minWords: 10 }
  );
  assert.equal(repetitive.ok, false);
  assert.equal(repetitive.reason, 'repetitive_phrase');
});

test('validateAiOutput accepts reasonable advisory text', () => {
  const good = validateAiOutput(
    'Wind is moderate and clouds are partly broken. From the lagoon you may get workable visibility, but keep an eye on marine forecasts and have a backup plan.',
    { minWords: 12, title: 'Launch viewing update' }
  );
  assert.equal(good.ok, true);
});

test('ollamaClient resolves base URL and model from env', () => {
  const prevUrl = process.env.OLLAMA_URL;
  const prevModel = process.env.OLLAMA_MODEL;
  process.env.OLLAMA_URL = 'http://127.0.0.1:11434/api/generate';
  process.env.OLLAMA_MODEL = 'llama3.1:8b';
  assert.equal(resolveOllamaBaseUrl(), 'http://127.0.0.1:11434');
  assert.equal(resolveModel(), 'llama3.1:8b');
  process.env.OLLAMA_URL = prevUrl;
  process.env.OLLAMA_MODEL = prevModel;
});

test('generateCaptainBobbyReply falls back when Ollama disabled', async () => {
  const prev = process.env.CAPTAIN_BOBBY_ENABLED;
  process.env.CAPTAIN_BOBBY_ENABLED = '0';
  const result = await generateCaptainBobbyReply({
    messages: [{ role: 'user', content: 'Can I book a pontoon tomorrow?' }],
    context: { page: '/faqs' },
  });
  assert.equal(result.ok, true);
  assert.equal(result.text, SAFE_STATIC_FALLBACK);
  assert.equal(result.fallback, true);
  process.env.CAPTAIN_BOBBY_ENABLED = prev;
});
