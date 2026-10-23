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
 * @param {string | null | undefined} value
 * @returns {boolean}
 */
export function isGiftIntentParam(value) {
  return String(value || '').trim().toLowerCase() === 'gift';
}

/**
 * @param {string | null | undefined} experience
 * @param {{ intent?: string | null } } [options]
 * @returns {string}
 */
export function directExperienceChooserPath(experience, options = {}) {
  const parsed = parseDirectExperienceParam(experience);
  if (!parsed) return DIRECT_DEALS_PATH;
  const params = new URLSearchParams();
  params.set('experience', parsed);
  if (isGiftIntentParam(options.intent)) {
    params.set('intent', 'gift');
  }
  return `${DIRECT_DEALS_PATH}?${params.toString()}`;
}

/**
 * Gift checkout path for bioluminescence packages (no departure date).
 * @param {string | null | undefined} packageId
 * @returns {string | null}
 */
export function bioGiftBookingUrl(packageId) {
  const id = String(packageId || '').trim();
  if (!id) return null;
  return `/booking/gift?package=${encodeURIComponent(id)}`;
}

/**
 * Existing BookNow URLs — same charterType + package pattern as bioBookingUrl / rocketBookingUrl / sunsetBookingUrl.
 * @param {string | null | undefined} experience
 * @param {string | null | undefined} packageId
 * @param {{ intent?: string | null } } [options]
 * @returns {string | null}
 */
export function bookingUrlForDirectPackage(experience, packageId, options = {}) {
  const exp = parseDirectExperienceParam(experience);
  const id = String(packageId || '').trim();
  if (!exp || !id) return null;
  if (exp === 'bio' && isGiftIntentParam(options.intent)) {
    return bioGiftBookingUrl(id);
  }
  const charterType = exp === 'rocket' ? 'rocket' : exp;
  return `/booking?bookingMode=charter&charterType=${charterType}&package=${encodeURIComponent(id)}`;
}
