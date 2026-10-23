'use strict';

process.env.BUSINESS_TIMEZONE = process.env.BUSINESS_TIMEZONE || 'America/New_York';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const assert = require('assert');
const {
  BIO_SEASONS,
  getActiveBioBookingSeason,
  validateBioBookingSeason,
  bioBookingSeasonClosedMessage,
} = require('../config/bioluminescenceSeason');
const availabilityService = require('../services/availabilityService');

function etStart(isoLocal) {
  // isoLocal like 2027-06-01T20:00:00 → treat as America/New_York wall time via offset for EDT (-04:00)
  return `${isoLocal}.000-04:00`;
}

function windowFor(startIso, hours = 1) {
  const startMs = new Date(startIso).getTime();
  const endIso = new Date(startMs + hours * 60 * 60 * 1000).toISOString();
  return { startIso, endIso };
}

function runConfigTests() {
  assert.strictEqual(BIO_SEASONS['2027'].bookingStart, '2027-06-01');
  assert.strictEqual(BIO_SEASONS['2027'].bookingEnd, '2027-10-31');
  assert.strictEqual(BIO_SEASONS['2027'].salesOpen, true);
  const season = getActiveBioBookingSeason();
  assert.strictEqual(season.year, 2027);
  assert.match(bioBookingSeasonClosedMessage(season), /2027 season/);
  assert.match(bioBookingSeasonClosedMessage(season), /June 1, 2027/);
  assert.match(bioBookingSeasonClosedMessage(season), /October 31, 2027/);
}

function runBoundaryValidationTests() {
  const cases = [
    ['2026-12-15T20:00:00', false],
    ['2027-05-31T20:00:00', false],
    ['2027-06-01T20:00:00', true],
    ['2027-10-31T20:00:00', true],
    // After midnight Nov 1 still belongs to Oct 31 operating night
    ['2027-11-01T01:00:00', true],
    ['2027-11-01T20:00:00', false],
  ];

  for (const [local, expectOk] of cases) {
    const startIso = etStart(local);
    const result = validateBioBookingSeason({ startIso });
    assert.strictEqual(
      result.ok,
      expectOk,
      `expected ok=${expectOk} for ${local}, got ${JSON.stringify(result)}`
    );
    if (!expectOk) {
      assert.match(String(result.message), /2027 season/);
    }
  }
}

function runAvailabilityWindowTests() {
  const inSeason = windowFor(etStart('2027-06-01T20:00:00'));
  const ok = availabilityService.validateCharterSlotWindow({
    charterType: 'bio',
    startIso: inSeason.startIso,
    endIso: inSeason.endIso,
  });
  assert.strictEqual(ok.valid, true, ok.message);

  const tooEarly = windowFor(etStart('2027-05-31T20:00:00'));
  const early = availabilityService.validateCharterSlotWindow({
    charterType: 'bio',
    startIso: tooEarly.startIso,
    endIso: tooEarly.endIso,
  });
  assert.strictEqual(early.valid, false);
  assert.match(String(early.message), /2027 season/);

  const afterSeasonEvening = windowFor(etStart('2027-11-01T20:00:00'));
  const late = availabilityService.validateCharterSlotWindow({
    charterType: 'bio',
    startIso: afterSeasonEvening.startIso,
    endIso: afterSeasonEvening.endIso,
  });
  assert.strictEqual(late.valid, false);
  assert.match(String(late.message), /2027 season/);

  // Sunset / rocket paths must not use the bio season gate.
  const sunset = availabilityService.validateCharterSlotWindow({
    charterType: 'sunset',
    startIso: etStart('2026-12-15T18:30:00'),
    endIso: new Date(new Date(etStart('2026-12-15T18:30:00')).getTime() + 2 * 60 * 60 * 1000).toISOString(),
  });
  // May fail for other night-window reasons on that weekday/time, but must NOT be the bio season message.
  if (!sunset.valid) {
    assert.doesNotMatch(String(sunset.message), /2027 season/);
  }
}

function run() {
  runConfigTests();
  runBoundaryValidationTests();
  runAvailabilityWindowTests();
  console.log('bioluminescenceSeason.test: all assertions passed');
}

run();
