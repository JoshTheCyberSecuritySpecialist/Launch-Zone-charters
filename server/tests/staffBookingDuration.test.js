const assert = require('assert');
const { resolveBookingRangeFromDuration } = require('../lib/bookingDateTimeRange');
const {
  CAPTAIN_LED_DEFAULT_DURATION_HOURS,
  applyStaffDurationPresetChange,
  computeStaffBookingOriginalPrice,
  defaultDurationPresetForBookingType,
  durationFieldsForNewBookingType,
  durationHoursFromStaffForm,
  staffDurationFieldsFromHours,
} = require('../lib/staffBookingDuration');

function parseStaffDuration(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

function run() {
  assert.strictEqual(CAPTAIN_LED_DEFAULT_DURATION_HOURS, 1);

  const rentalNew = durationFieldsForNewBookingType('rental');
  assert.strictEqual(rentalNew.durationPreset, '4');
  assert.strictEqual(rentalNew.customDuration, '');

  const charterNew = durationFieldsForNewBookingType('captain_charter');
  assert.strictEqual(charterNew.durationPreset, '1');
  assert.strictEqual(charterNew.customDuration, '');

  assert.strictEqual(defaultDurationPresetForBookingType('captain_charter'), '1');
  assert.strictEqual(defaultDurationPresetForBookingType('rental'), '4');

  const charterSwitch = durationFieldsForNewBookingType('captain_charter');
  assert.strictEqual(charterSwitch.durationPreset, '1');

  const editFour = staffDurationFieldsFromHours(4);
  assert.strictEqual(editFour.durationPreset, '4');
  assert.strictEqual(editFour.customDuration, '');

  const editCustom = staffDurationFieldsFromHours(3.5);
  assert.strictEqual(editCustom.durationPreset, 'custom');
  assert.strictEqual(editCustom.customDuration, '3.5');

  assert.strictEqual(durationHoursFromStaffForm('custom', '5'), 5);
  assert.strictEqual(durationHoursFromStaffForm('1', '99'), 1);

  const fromCustomToOne = applyStaffDurationPresetChange('1');
  assert.strictEqual(fromCustomToOne.durationPreset, '1');
  assert.strictEqual(fromCustomToOne.customDuration, '');

  const overnight = resolveBookingRangeFromDuration({
    date: '2026-07-19',
    startTime: '23:30',
    durationHours: 1,
  });
  assert.strictEqual(overnight.ok, true);
  assert.strictEqual(overnight.durationHours, 1);
  assert.strictEqual(overnight.crossesMidnight, true);

  const boat = { hourly_rate: 120, half_day_rate: 400, full_day_rate: 700 };
  assert.strictEqual(computeStaffBookingOriginalPrice(boat, 1, 'captain_charter'), 170);
  assert.strictEqual(computeStaffBookingOriginalPrice(boat, 4, 'rental'), 400);

  assert.strictEqual(parseStaffDuration(1), 1);
  assert.strictEqual(parseStaffDuration(0.5), 0.5);
  assert.strictEqual(parseStaffDuration(0), null);

  console.log('staffBookingDuration.test: all assertions passed');
}

run();
