/**
 * Direct-booking navigation helpers.
 * Package prices and guest rules stay in the experience package modules / server config.
 */

export const DIRECT_DEALS_PATH = '/booking/direct';

/**
 * @param {string | null | undefined} value
 * @returns {'bio' | 'rocket' | 'sunset' | null}
 */
export function parseDirectExperienceParam(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'bio' || v === 'night_bio') return 'bio';
  if (v === 'rocket' || v === 'rocket_launch') return 'rocket';
  if (v === 'sunset' || v === 'sunset_cruise') return 'sunset';
  return null;
}

/**
 * @param {string | null | undefined} experience
 * @returns {string}
 */
export function directExperienceChooserPath(experience) {
  const parsed = parseDirectExperienceParam(experience);
  if (!parsed) return DIRECT_DEALS_PATH;
  return `${DIRECT_DEALS_PATH}?experience=${encodeURIComponent(parsed)}`;
}

/**
 * Existing BookNow URLs — same charterType + package pattern as bioBookingUrl / rocketBookingUrl / sunsetBookingUrl.
 * @param {string | null | undefined} experience
 * @param {string | null | undefined} packageId
 * @returns {string | null}
 */
export function bookingUrlForDirectPackage(experience, packageId) {
  const exp = parseDirectExperienceParam(experience);
  const id = String(packageId || '').trim();
  if (!exp || !id) return null;
  const charterType = exp === 'rocket' ? 'rocket' : exp;
  return `/booking?bookingMode=charter&charterType=${charterType}&package=${encodeURIComponent(id)}`;
}
