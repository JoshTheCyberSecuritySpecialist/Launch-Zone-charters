'use strict';

const assert = require('assert');
const {
  RENTAL_OPEN_HOUR,
  RENTAL_CLOSE_HOUR,
  RENTAL_SLOT_STEP_MINUTES,
  RENTAL_ALLOWED_DIRECT_DURATIONS,
  RENTAL_MAX_PASSENGERS,
  RENTAL_PACKAGE_IDS,
  RENTAL_PACKAGES,
  resolveDirectRentalPackage,
  validateRentalSchedule,
  listValidStartHoursForDuration,
  basePriceUsdForDirectPackage,
  rentalTypeForDurationHours,
} = require('../config/rentalPackages');

function isoLocal(date, hour, minute = 0) {
  // America/New_York offset approximated as -04:00 (EDT) for fixed assertions.
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return `${date}T${hh}:${mm}:00.000-04:00`;
}

function run() {
  assert.strictEqual(RENTAL_OPEN_HOUR, 6);
  assert.strictEqual(RENTAL_CLOSE_HOUR, 17);
  assert.strictEqual(RENTAL_SLOT_STEP_MINUTES, 60);
  assert.deepStrictEqual([...RENTAL_ALLOWED_DIRECT_DURATIONS], [4, 6]);
  assert.strictEqual(RENTAL_MAX_PASSENGERS, 6);

  const four = RENTAL_PACKAGES[RENTAL_PACKAGE_IDS.FOUR_HOUR];
  const six = RENTAL_PACKAGES[RENTAL_PACKAGE_IDS.SIX_HOUR];
  assert.strictEqual(four.priceCents, 14999);
  assert.strictEqual(six.priceCents, 20999);
  assert.strictEqual(basePriceUsdForDirectPackage(four), 149.99);
  assert.strictEqual(basePriceUsdForDirectPackage(six), 209.99);
  assert.strictEqual(four.rentalType, 'half_day');
  assert.strictEqual(six.rentalType, 'hourly');

  assert.strictEqual(rentalTypeForDurationHours(4), 'half_day');
  assert.strictEqual(rentalTypeForDurationHours(6), 'hourly');
  assert.strictEqual(rentalTypeForDurationHours(8, { allowLegacyFullDay: true }), 'full_day');

  const ok4 = resolveDirectRentalPackage({ durationHours: 4, rentalType: 'half_day' });
  assert.strictEqual(ok4.ok, true);
  assert.strictEqual(ok4.package.id, 'rental_4hr');

  const ok6 = resolveDirectRentalPackage({ durationHours: 6, rentalType: 'hourly' });
  assert.strictEqual(ok6.ok, true);
  assert.strictEqual(ok6.package.id, 'rental_6hr');

  const reject8 = resolveDirectRentalPackage({ durationHours: 8, rentalType: 'full_day' });
  assert.strictEqual(reject8.ok, false);
  assert.match(String(reject8.error), /8-hour/i);

  const reject5 = resolveDirectRentalPackage({ durationHours: 5 });
  assert.strictEqual(reject5.ok, false);

  // Valid windows
  assert.strictEqual(
    validateRentalSchedule({
      startIso: isoLocal('2026-09-15', 6),
      endIso: isoLocal('2026-09-15', 10),
      durationHours: 4,
      mode: 'direct',
    }).ok,
    true
  );
  assert.strictEqual(
    validateRentalSchedule({
      startIso: isoLocal('2026-09-15', 13),
      endIso: isoLocal('2026-09-15', 17),
      durationHours: 4,
      mode: 'direct',
    }).ok,
    true
  );
  assert.strictEqual(
    validateRentalSchedule({
      startIso: isoLocal('2026-09-15', 6),
      endIso: isoLocal('2026-09-15', 12),
      durationHours: 6,
      mode: 'direct',
    }).ok,
    true
  );
  assert.strictEqual(
    validateRentalSchedule({
      startIso: isoLocal('2026-09-15', 11),
      endIso: isoLocal('2026-09-15', 17),
      durationHours: 6,
      mode: 'direct',
    }).ok,
    true
  );

  // Invalid: before open
  assert.strictEqual(
    validateRentalSchedule({
      startIso: isoLocal('2026-09-15', 5),
      endIso: isoLocal('2026-09-15', 9),
      durationHours: 4,
      mode: 'direct',
    }).ok,
    false
  );

  // Invalid: 4h starting 2 PM ends 6 PM
  assert.strictEqual(
    validateRentalSchedule({
      startIso: isoLocal('2026-09-15', 14),
      endIso: isoLocal('2026-09-15', 18),
      durationHours: 4,
      mode: 'direct',
    }).ok,
    false
  );

  // Invalid: 6h starting noon ends 6 PM
  assert.strictEqual(
    validateRentalSchedule({
      startIso: isoLocal('2026-09-15', 12),
      endIso: isoLocal('2026-09-15', 18),
      durationHours: 6,
      mode: 'direct',
    }).ok,
    false
  );

  // Invalid: end one minute after 5 PM
  assert.strictEqual(
    validateRentalSchedule({
      startIso: isoLocal('2026-09-15', 13),
      endIso: isoLocal('2026-09-15', 17, 1),
      durationHours: 4,
      mode: 'direct',
    }).ok,
    false
  );

  // Invalid: non-hourly start
  assert.strictEqual(
    validateRentalSchedule({
      startIso: isoLocal('2026-09-15', 6, 30),
      endIso: isoLocal('2026-09-15', 10, 30),
      durationHours: 4,
      mode: 'direct',
    }).ok,
    false
  );

  // Invalid: manipulated end time
  assert.strictEqual(
    validateRentalSchedule({
      startIso: isoLocal('2026-09-15', 6),
      endIso: isoLocal('2026-09-15', 11),
      durationHours: 4,
      mode: 'direct',
    }).ok,
    false
  );

  // Invalid: 8h direct
  assert.strictEqual(
    validateRentalSchedule({
      startIso: isoLocal('2026-09-15', 6),
      endIso: isoLocal('2026-09-15', 14),
      durationHours: 8,
      mode: 'direct',
    }).ok,
    false
  );

  // Groupon may still use 8h if it finishes by 5 PM
  assert.strictEqual(
    validateRentalSchedule({
      startIso: isoLocal('2026-09-15', 6),
      endIso: isoLocal('2026-09-15', 14),
      durationHours: 8,
      mode: 'groupon',
    }).ok,
    true
  );
  assert.strictEqual(
    validateRentalSchedule({
      startIso: isoLocal('2026-09-15', 10),
      endIso: isoLocal('2026-09-15', 18),
      durationHours: 8,
      mode: 'groupon',
    }).ok,
    false
  );

  assert.deepStrictEqual(listValidStartHoursForDuration(4), [6, 7, 8, 9, 10, 11, 12, 13]);
  assert.deepStrictEqual(listValidStartHoursForDuration(6), [6, 7, 8, 9, 10, 11]);

  console.log('rentalPackages.test: all assertions passed');
}

run();
