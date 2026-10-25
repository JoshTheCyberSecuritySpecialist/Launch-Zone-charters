/**
 * Visual themes for bioluminescence gift tickets (browser + PDF/PNG).
 * Selection is stored on the paid checkout draft and passed to PDF export.
 */

export const BIO_GIFT_TICKET_THEME_IDS = ['glow', 'space', 'golden'] as const;

export type BioGiftTicketThemeId = (typeof BIO_GIFT_TICKET_THEME_IDS)[number];

export type BioGiftTicketTheme = {
  id: BioGiftTicketThemeId;
  label: string;
  shortLabel: string;
  description: string;
  /** Tailwind-friendly accent for picker chips */
  chipClass: string;
};

export const BIO_GIFT_TICKET_THEMES: Record<BioGiftTicketThemeId, BioGiftTicketTheme> = {
  glow: {
    id: 'glow',
    label: 'Bioluminescent Glow',
    shortLabel: 'Glow',
    description: 'Deep navy lagoon with electric cyan wake',
    chipClass: 'border-cyan-400/50 bg-cyan-950/40 text-cyan-100',
  },
  space: {
    id: 'space',
    label: 'Space Coast Night',
    shortLabel: 'Space Coast',
    description: 'Starry coastal night with violet launch accents',
    chipClass: 'border-violet-400/50 bg-violet-950/40 text-violet-100',
  },
  golden: {
    id: 'golden',
    label: 'Golden Adventure Pass',
    shortLabel: 'Golden',
    description: 'Dark premium ticket with gold luxury accents',
    chipClass: 'border-amber-400/50 bg-amber-950/40 text-amber-100',
  },
};

export function normalizeBioGiftTicketTheme(raw: unknown): BioGiftTicketThemeId {
  const id = String(raw || '')
    .trim()
    .toLowerCase();
  if (id === 'space' || id === 'space_coast' || id === 'spacecoast') return 'space';
  if (id === 'golden' || id === 'gold' || id === 'luxury') return 'golden';
  if (id === 'glow' || id === 'bioluminescent' || id === 'bio') return 'glow';
  return 'glow';
}

export function bioGiftThemeStorageKey(sessionId: string): string {
  return `lzc-bio-gift-theme:${String(sessionId || '').trim()}`;
}

export function readStoredBioGiftTheme(sessionId: string): BioGiftTicketThemeId | null {
  try {
    const raw = localStorage.getItem(bioGiftThemeStorageKey(sessionId));
    if (!raw) return null;
    return normalizeBioGiftTicketTheme(raw);
  } catch {
    return null;
  }
}

export function writeStoredBioGiftTheme(sessionId: string, theme: BioGiftTicketThemeId): void {
  try {
    localStorage.setItem(bioGiftThemeStorageKey(sessionId), theme);
  } catch {
    /* ignore quota / private mode */
  }
}
