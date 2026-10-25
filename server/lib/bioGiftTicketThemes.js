/**
 * Shared gift ticket theme ids + PDF color tokens (mirrors src/lib/bioGiftTicketThemes.ts).
 */

const BIO_GIFT_TICKET_THEME_IDS = Object.freeze(['glow', 'space', 'golden']);

const THEME_PDF = Object.freeze({
  glow: {
    id: 'glow',
    cardBg: '#071018',
    stubBg: '#050d16',
    accent: '#67e8f9',
    accentSoft: '#a5f3fc',
    glow: '#22d3ee',
    label: '#67e8f9',
    text: '#ffffff',
    muted: '#94a3b8',
    quote: '#cbd5e1',
    multi: '#fb923c',
    qrLight: '#E8F7FF',
    qrDark: '#0B1220',
  },
  space: {
    id: 'space',
    cardBg: '#09091a',
    stubBg: '#060612',
    accent: '#c4b5fd',
    accentSoft: '#ddd6fe',
    glow: '#818cf8',
    label: '#a5b4fc',
    text: '#ffffff',
    muted: '#94a3b8',
    quote: '#d4d4d8',
    multi: '#fb923c',
    qrLight: '#F5F3FF',
    qrDark: '#1e1b4b',
  },
  golden: {
    id: 'golden',
    cardBg: '#120e08',
    stubBg: '#0c0905',
    accent: '#fbbf24',
    accentSoft: '#fde68a',
    glow: '#d97706',
    label: '#fcd34d',
    text: '#fffbeb',
    muted: '#a8a29e',
    quote: '#e7e5e4',
    multi: '#f59e0b',
    qrLight: '#FFFBEB',
    qrDark: '#1c1917',
  },
});

function normalizeBioGiftTicketTheme(raw) {
  const id = String(raw || '')
    .trim()
    .toLowerCase();
  if (id === 'space' || id === 'space_coast' || id === 'spacecoast') return 'space';
  if (id === 'golden' || id === 'gold' || id === 'luxury') return 'golden';
  if (id === 'glow' || id === 'bioluminescent' || id === 'bio') return 'glow';
  return 'glow';
}

function themePdfTokens(themeId) {
  const id = normalizeBioGiftTicketTheme(themeId);
  return THEME_PDF[id] || THEME_PDF.glow;
}

module.exports = {
  BIO_GIFT_TICKET_THEME_IDS,
  THEME_PDF,
  normalizeBioGiftTicketTheme,
  themePdfTokens,
};
