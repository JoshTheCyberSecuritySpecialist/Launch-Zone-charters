/**
 * Authoritative bioluminescence product booking seasons.
 * Glow-forecast May–Oct marketing in bioGlowModel is separate — do not reuse that for checkout.
 *
 * Operating-night anchor (America/New_York): a 1:00 AM start on Nov 1 belongs to Oct 31's night.
 */

const { DateTime } = require('luxon');
const {
  BUSINESS_TZ,
  getCaptainNightAnchorDay,
} = require('../lib/captainNightSchedule');

/** @type {Record<string, { bookingStart: string, bookingEnd: string, salesOpen: boolean }>} */
const BIO_SEASONS = Object.freeze({
  2027: {
    bookingStart: '2027-06-01',
    bookingEnd: '2027-10-31',
    salesOpen: true,
  },
});

function listOpenBioSeasons() {
  return Object.entries(BIO_SEASONS)
    .filter(([, season]) => season && season.salesOpen !== false)
    .map(([year, season]) => ({
      year: Number(year),
      bookingStart: String(season.bookingStart),
      bookingEnd: String(season.bookingEnd),
      salesOpen: true,
    }))
    .sort((a, b) => a.year - b.year);
}

function getActiveBioBookingSeason(now = DateTime.now()) {
  const open = listOpenBioSeasons();
  if (!open.length) return null;

  const current = now && typeof now.setZone === 'function'
    ? now.setZone(BUSINESS_TZ)
    : DateTime.fromJSDate(now instanceof Date ? now : new Date(), { zone: BUSINESS_TZ });
  const today = current.isValid ? current.toFormat('yyyy-MM-dd') : null;

  if (today) {
    const inWindow = open.find((s) => today >= s.bookingStart && today <= s.bookingEnd);
    if (inWindow) return inWindow;
    const upcoming = open.find((s) => today < s.bookingStart);
    if (upcoming) return upcoming;
  }
  return open[open.length - 1];
}

function formatBioSeasonRangeLabel(season) {
  if (!season) return '';
  const start = DateTime.fromISO(season.bookingStart, { zone: BUSINESS_TZ });
  const end = DateTime.fromISO(season.bookingEnd, { zone: BUSINESS_TZ });
  if (!start.isValid || !end.isValid) {
    return `${season.bookingStart} through ${season.bookingEnd}`;
  }
  return `${start.toFormat('MMMM d, yyyy')} and ${end.toFormat('MMMM d, yyyy')}`;
}

function bioBookingSeasonClosedMessage(season = getActiveBioBookingSeason()) {
  if (!season) {
    return 'Bioluminescence tours are not open for booking right now. Please call 803-542-1761 for help.';
  }
  return `Bioluminescence tours are currently booking for the ${season.year} season. Choose a date between ${formatBioSeasonRangeLabel(season)}.`;
}

function isBioOperatingDateInSeason(anchorDateStr, season = getActiveBioBookingSeason()) {
  const day = String(anchorDateStr || '').trim();
  if (!day || !season) return false;
  return day >= season.bookingStart && day <= season.bookingEnd;
}

/**
 * @param {{ startIso?: string, season?: object|null }} input
 * @returns {{ ok: boolean, message: string|null, season: object|null, anchorDate: string|null }}
 */
function validateBioBookingSeason({ startIso, season = getActiveBioBookingSeason() } = {}) {
  if (!season) {
    return {
      ok: false,
      message: bioBookingSeasonClosedMessage(null),
      season: null,
      anchorDate: null,
    };
  }
  const start = DateTime.fromISO(String(startIso || ''), { zone: 'utc' }).setZone(BUSINESS_TZ);
  if (!start.isValid) {
    return {
      ok: false,
      message: 'Invalid charter start time.',
      season,
      anchorDate: null,
    };
  }
  const anchor = getCaptainNightAnchorDay(start);
  const anchorDate = anchor && anchor.isValid ? anchor.toFormat('yyyy-MM-dd') : null;
  if (!anchorDate || !isBioOperatingDateInSeason(anchorDate, season)) {
    return {
      ok: false,
      message: bioBookingSeasonClosedMessage(season),
      season,
      anchorDate,
    };
  }
  return { ok: true, message: null, season, anchorDate };
}

module.exports = {
  BIO_SEASONS,
  listOpenBioSeasons,
  getActiveBioBookingSeason,
  formatBioSeasonRangeLabel,
  bioBookingSeasonClosedMessage,
  isBioOperatingDateInSeason,
  validateBioBookingSeason,
};
