const assert = require('assert');
const { DateTime } = require('luxon');

const {
  closestHourlyIndex,
  parseProviderHourlyMillis,
} = require('../services/marineConditionsService');

function run() {
  const zone = 'America/New_York';

  const edt = parseProviderHourlyMillis('2026-09-16T18:00', zone);
  assert.strictEqual(
    new Date(edt).toISOString(),
    '2026-09-16T22:00:00.000Z',
    'offsetless Open-Meteo EDT hour should be interpreted as Eastern wall-clock time'
  );

  const est = parseProviderHourlyMillis('2026-12-16T18:00', zone);
  assert.strictEqual(
    new Date(est).toISOString(),
    '2026-12-16T23:00:00.000Z',
    'offsetless Open-Meteo EST hour should use the standard-time offset automatically'
  );

  const explicitUtc = parseProviderHourlyMillis('2026-09-16T22:00:00Z', zone);
  assert.strictEqual(
    new Date(explicitUtc).toISOString(),
    '2026-09-16T22:00:00.000Z',
    'explicit UTC provider timestamps should not be converted as local wall-clock time'
  );

  const nowMs = DateTime.fromISO('2026-09-16T18:20:00', { zone }).toUTC().toMillis();
  assert.strictEqual(
    closestHourlyIndex(['2026-09-16T17:00', '2026-09-16T18:00', '2026-09-16T19:00'], nowMs, zone),
    1,
    'closest hourly match should be selected after normalizing provider timestamps'
  );

  console.log('marineConditionsTime.test: all assertions passed');
}

run();
