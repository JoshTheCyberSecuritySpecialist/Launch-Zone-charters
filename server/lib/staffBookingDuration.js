/** Keep in sync with src/lib/staffBookingDuration.ts (tested here). */

const CAPTAIN_LED_DEFAULT_DURATION_HOURS = 1;
const RENTAL_DEFAULT_DURATION_PRESET = '4';
const CHARTER_DEFAULT_DURATION_PRESET = '1';
const STAFF_DURATION_PRESET_HOURS = ['1', '2', '4', '6', '8'];

function isStaffDurationPresetHours(value) {
  return STAFF_DURATION_PRESET_HOURS.includes(value);
}

function defaultDurationPresetForBookingType(bookingType) {
  return bookingType === 'captain_charter' ? CHARTER_DEFAULT_DURATION_PRESET : RENTAL_DEFAULT_DURATION_PRESET;
}

function durationHoursFromStaffForm(durationPreset, customDuration) {
  if (durationPreset === 'custom') {
    const n = Number(customDuration);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }
  return Number(durationPreset);
}

function staffDurationFieldsFromHours(hours) {
  const text = String(hours).trim();
  if (!text) {
    return { durationPreset: RENTAL_DEFAULT_DURATION_PRESET, customDuration: '' };
  }
  if (isStaffDurationPresetHours(text)) {
    return { durationPreset: text, customDuration: '' };
  }
  const n = Number(text);
  if (Number.isFinite(n) && n > 0 && isStaffDurationPresetHours(String(n))) {
    return { durationPreset: String(n), customDuration: '' };
  }
  if (Number.isFinite(n) && n > 0) {
    return { durationPreset: 'custom', customDuration: String(n) };
  }
  return { durationPreset: RENTAL_DEFAULT_DURATION_PRESET, customDuration: '' };
}

function durationFieldsForNewBookingType(bookingType) {
  return {
    durationPreset: defaultDurationPresetForBookingType(bookingType),
    customDuration: '',
  };
}

function applyStaffDurationPresetChange(nextPreset) {
  if (nextPreset === 'custom') {
    return { durationPreset: 'custom', customDuration: '' };
  }
  return { durationPreset: nextPreset, customDuration: '' };
}

function computeStaffBookingOriginalPrice(boat, durationHours, bookingType) {
  const CAPTAIN_HOURLY = 50;
  if (!boat || durationHours <= 0) return 0;
  const hourly = Number(boat.hourly_rate || 0);
  const half = Number(boat.half_day_rate || 0);
  const full = Number(boat.full_day_rate || 0);
  let base = hourly * durationHours;
  if (Math.abs(durationHours - 4) < 0.01) base = half || base;
  if (Math.abs(durationHours - 8) < 0.01) base = full || base;
  if (bookingType === 'captain_charter') {
    base += Math.round(CAPTAIN_HOURLY * durationHours * 100) / 100;
  }
  return Math.round(base * 100) / 100;
}

module.exports = {
  CAPTAIN_LED_DEFAULT_DURATION_HOURS,
  RENTAL_DEFAULT_DURATION_PRESET,
  CHARTER_DEFAULT_DURATION_PRESET,
  STAFF_DURATION_PRESET_HOURS,
  applyStaffDurationPresetChange,
  computeStaffBookingOriginalPrice,
  defaultDurationPresetForBookingType,
  durationFieldsForNewBookingType,
  durationHoursFromStaffForm,
  isStaffDurationPresetHours,
  staffDurationFieldsFromHours,
};
