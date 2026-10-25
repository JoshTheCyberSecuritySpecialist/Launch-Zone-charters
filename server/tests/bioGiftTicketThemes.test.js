const assert = require('assert');
const {
  normalizeBioGiftTicketTheme,
  themePdfTokens,
  BIO_GIFT_TICKET_THEME_IDS,
} = require('../lib/bioGiftTicketThemes');

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`fail - ${name}`);
    throw err;
  }
}

test('normalizes theme aliases', () => {
  assert.strictEqual(normalizeBioGiftTicketTheme('glow'), 'glow');
  assert.strictEqual(normalizeBioGiftTicketTheme('SPACE_COAST'), 'space');
  assert.strictEqual(normalizeBioGiftTicketTheme('gold'), 'golden');
  assert.strictEqual(normalizeBioGiftTicketTheme('nope'), 'glow');
  assert.deepStrictEqual([...BIO_GIFT_TICKET_THEME_IDS], ['glow', 'space', 'golden']);
});

test('pdf tokens differ by theme', () => {
  const glow = themePdfTokens('glow');
  const space = themePdfTokens('space');
  const golden = themePdfTokens('golden');
  assert.notStrictEqual(glow.cardBg, space.cardBg);
  assert.notStrictEqual(glow.accent, golden.accent);
  assert.ok(golden.accent.startsWith('#'));
});

console.log('bioGiftTicketThemes tests passed');
