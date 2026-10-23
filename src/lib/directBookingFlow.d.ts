export const DIRECT_DEALS_PATH: '/booking/direct';

export type DirectExperienceQuery = 'bio' | 'rocket' | 'sunset';

export function parseDirectExperienceParam(
  value: string | null | undefined
): DirectExperienceQuery | null;

export function isGiftIntentParam(value: string | null | undefined): boolean;

export function directExperienceChooserPath(
  experience: string | null | undefined,
  options?: { intent?: string | null }
): string;

export function bioGiftBookingUrl(packageId: string | null | undefined): string | null;

export function bookingUrlForDirectPackage(
  experience: string | null | undefined,
  packageId: string | null | undefined,
  options?: { intent?: string | null }
): string | null;
