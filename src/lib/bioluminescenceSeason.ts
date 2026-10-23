/**
 * Presentation mirror of server/config/bioluminescenceSeason.js.
 * Server enforces season on availability and checkout — never trust the browser alone.
 */

export type BioSeasonConfig = {
  year: number;
  bookingStart: string;
  bookingEnd: string;
  salesOpen: boolean;
};

export const BIO_SEASONS: Readonly<Record<string, Omit<BioSeasonConfig, 'year'>>> = {
  2027: {
    bookingStart: '2027-06-01',
    bookingEnd: '2027-10-31',
    salesOpen: true,
  },
};

export function listOpenBioSeasons(): BioSeasonConfig[] {
  return Object.entries(BIO_SEASONS)
    .filter(([, season]) => season?.salesOpen !== false)
    .map(([year, season]) => ({
      year: Number(year),
      bookingStart: season.bookingStart,
      bookingEnd: season.bookingEnd,
      salesOpen: true,
    }))
    .sort((a, b) => a.year - b.year);
}

export function getActiveBioBookingSeason(todayYmd?: string): BioSeasonConfig | null {
  const open = listOpenBioSeasons();
  if (!open.length) return null;
  const today =
    todayYmd ||
    (() => {
      const n = new Date();
      return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
    })();
  const inWindow = open.find((s) => today >= s.bookingStart && today <= s.bookingEnd);
  if (inWindow) return inWindow;
  const upcoming = open.find((s) => today < s.bookingStart);
  if (upcoming) return upcoming;
  return open[open.length - 1];
}

export function formatBioSeasonRangeLabel(season: BioSeasonConfig | null | undefined): string {
  if (!season) return '';
  try {
    const start = new Date(`${season.bookingStart}T12:00:00`);
    const end = new Date(`${season.bookingEnd}T12:00:00`);
    const fmt = new Intl.DateTimeFormat('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'America/New_York',
    });
    return `${fmt.format(start)} and ${fmt.format(end)}`;
  } catch {
    return `${season.bookingStart} through ${season.bookingEnd}`;
  }
}

export function bioBookingSeasonClosedMessage(season?: BioSeasonConfig | null): string {
  const active = season === undefined ? getActiveBioBookingSeason() : season;
  if (!active) {
    return 'Bioluminescence tours are not open for booking right now. Please call 803-542-1761 for help.';
  }
  return `Bioluminescence tours are currently booking for the ${active.year} season. Choose a date between ${formatBioSeasonRangeLabel(active)}.`;
}

/** First calendar month to show for bio booking (season start month). */
export function bioSeasonDefaultCalendarMonth(season = getActiveBioBookingSeason()): Date {
  if (!season?.bookingStart) {
    return new Date();
  }
  const [y, m] = season.bookingStart.split('-').map(Number);
  if (!y || !m) return new Date();
  return new Date(y, m - 1, 1);
}

/** Marketing copy for end-of-season / advance-sale surfaces (Phase 3+). */
export function bioSeasonAdvanceSaleCopy(season = getActiveBioBookingSeason()) {
  const year = season?.year ?? 2027;
  return {
    eyebrow: `${year} season open`,
    headline: `${year} Bioluminescence Season Is Now Open`,
    supporting:
      "The glow returns next summer. Reserve your adventure now or give someone a night on the water they'll never forget.",
    bookCta: `Book a ${year} Tour`,
    giftCta: 'Give as a Gift',
    giftEyebrow: 'Give the glow',
    giftHeadline: 'A night on the glowing water beats another gift card',
    giftSupporting:
      'No date required. Your recipient chooses their 2027 adventure later.',
    bookHref: '/booking/direct?experience=bio',
    giftHref: '/bioluminescent-tours#give-as-gift',
    giftIntentHref: '/booking/direct?experience=bio&intent=gift',
  } as const;
}
