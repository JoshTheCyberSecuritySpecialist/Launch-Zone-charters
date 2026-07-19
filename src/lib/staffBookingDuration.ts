import { captainFeeForHours } from '../config/pricing';

export const CAPTAIN_LED_DEFAULT_DURATION_HOURS = 1;

export const RENTAL_DEFAULT_DURATION_PRESET = '4' as const;
export const CHARTER_DEFAULT_DURATION_PRESET = '1' as const;

export const STAFF_DURATION_PRESET_HOURS = ['1', '2', '4', '6', '8'] as const;

export type StaffDurationPreset = (typeof STAFF_DURATION_PRESET_HOURS)[number] | 'custom';

export type StaffBookingType = 'rental' | 'captain_charter';

export function isStaffDurationPresetHours(value: string): value is (typeof STAFF_DURATION_PRESET_HOURS)[number] {
  return (STAFF_DURATION_PRESET_HOURS as readonly string[]).includes(value);
}

export function defaultDurationPresetForBookingType(bookingType: StaffBookingType): StaffDurationPreset {
  return bookingType === 'captain_charter' ? CHARTER_DEFAULT_DURATION_PRESET : RENTAL_DEFAULT_DURATION_PRESET;
}

export function durationHoursFromStaffForm(durationPreset: StaffDurationPreset, customDuration: string): number {
  if (durationPreset === 'custom') {
    const n = Number(customDuration);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }
  return Number(durationPreset);
}

/** Map stored or URL hours to preset + optional custom field (for prefill, not edit pages). */
export function staffDurationFieldsFromHours(hours: number | string): {
  durationPreset: StaffDurationPreset;
  customDuration: string;
} {
  const text = String(hours).trim();
  if (!text) {
    return { durationPreset: RENTAL_DEFAULT_DURATION_PRESET, customDuration: '' };
  }
  if (isStaffDurationPresetHours(text)) {
    return { durationPreset: text, customDuration: '' };
  }
  const n = Number(text);
  if (Number.isFinite(n) && n > 0 && isStaffDurationPresetHours(String(n))) {
    return { durationPreset: String(n) as StaffDurationPreset, customDuration: '' };
  }
  if (Number.isFinite(n) && n > 0) {
    return { durationPreset: 'custom', customDuration: String(n) };
  }
  return { durationPreset: RENTAL_DEFAULT_DURATION_PRESET, customDuration: '' };
}

export function durationFieldsForNewBookingType(bookingType: StaffBookingType): {
  durationPreset: StaffDurationPreset;
  customDuration: string;
} {
  return {
    durationPreset: defaultDurationPresetForBookingType(bookingType),
    customDuration: '',
  };
}

export function applyStaffDurationPresetChange(
  nextPreset: StaffDurationPreset,
  _prevCustomDuration: string
): { durationPreset: StaffDurationPreset; customDuration: string } {
  if (nextPreset === 'custom') {
    return { durationPreset: 'custom', customDuration: '' };
  }
  return { durationPreset: nextPreset, customDuration: '' };
}

type BoatRates = {
  hourly_rate?: number | string | null;
  half_day_rate?: number | string | null;
  full_day_rate?: number | string | null;
};

export function computeStaffBookingOriginalPrice(
  boat: BoatRates | null,
  durationHours: number,
  bookingType: StaffBookingType
): number {
  if (!boat || durationHours <= 0) return 0;
  const hourly = Number(boat.hourly_rate || 0);
  const half = Number(boat.half_day_rate || 0);
  const full = Number(boat.full_day_rate || 0);
  let base = hourly * durationHours;
  if (Math.abs(durationHours - 4) < 0.01) base = half || base;
  if (Math.abs(durationHours - 8) < 0.01) base = full || base;
  if (bookingType === 'captain_charter') base += captainFeeForHours(durationHours);
  return Math.round(base * 100) / 100;
}
