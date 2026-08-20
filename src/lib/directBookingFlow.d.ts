export const DIRECT_DEALS_PATH: '/booking/direct';

export type DirectExperienceQuery = 'bio' | 'rocket' | 'sunset';

export function parseDirectExperienceParam(
  value: string | null | undefined
): DirectExperienceQuery | null;

export function directExperienceChooserPath(
  experience: string | null | undefined
): string;

export function bookingUrlForDirectPackage(
  experience: string | null | undefined,
  packageId: string | null | undefined
): string | null;
