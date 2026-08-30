'use strict';

const assert = require('assert');
const { DateTime } = require('luxon');
const { resolveOperatingLocation } = require('../lib/operatingLocations');
const { buildCharterWeatherOutlook } = require('../lib/charterWeatherOutlook');
const {
  aggregateWindowHours,
  collectWindowHours,
  hourlyOverlapsWindow,
  resolveCharterWeatherWindow,
} = require('../lib/charterWeatherWindow');

function run() {
  const titusville = resolveOperatingLocation('titusville');
  const portOrange = resolveOperatingLocation('Port Orange');
  assert.strictEqual(titusville.ok, true);
  assert.strictEqual(titusville.location.lat, 28.6122);
  assert.strictEqual(titusville.location.lon, -80.8076);
  assert.strictEqual(portOrange.ok, true);
  assert.strictEqual(portOrange.location.id, 'daytona');
  assert.strictEqual(portOrange.location.lat, 29.1383);

  const rejected = resolveOperatingLocation('hawaii', { defaultKey: null });
  assert.strictEqual(rejected.ok, false);
  const missing = resolveOperatingLocation('', { defaultKey: null });
  assert.strictEqual(missing.ok, false);

  const evening = resolveCharterWeatherWindow({
    date: '2026-08-30',
    startTime: '20:00',
    durationMinutes: 60,
  });
  assert.strictEqual(evening.ok, true);
  assert.strictEqual(evening.timeZone, 'America/New_York');
  assert.strictEqual(evening.crossesMidnight, false);
  assert.ok(evening.label.includes('8:00 PM'));
  assert.ok(evening.label.includes('9:00 PM'));

  const utcStart = DateTime.fromISO(evening.startIso, { zone: 'utc' }).setZone('America/New_York');
  assert.strictEqual(utcStart.toFormat('HH:mm'), '20:00');
  assert.ok(evening.startIso.endsWith('Z'));

  const midnight = resolveCharterWeatherWindow({
    date: '2026-08-30',
    startTime: '23:00',
    durationMinutes: 60,
  });
  assert.strictEqual(midnight.ok, true);
  assert.strictEqual(midnight.crossesMidnight, true);
  const midnightEnd = DateTime.fromISO(midnight.endIso, { zone: 'utc' }).setZone('America/New_York');
  assert.strictEqual(midnightEnd.toFormat('yyyy-MM-dd HH:mm'), '2026-08-31 00:00');

  const springForward = resolveCharterWeatherWindow({
    date: '2026-03-08',
    startTime: '01:30',
    durationMinutes: 60,
  });
  assert.strictEqual(springForward.ok, true);
  assert.strictEqual(springForward.durationMinutes, 60);
  const springEnd = DateTime.fromISO(springForward.endIso, { zone: 'utc' }).setZone('America/New_York');
  assert.strictEqual(springEnd.toFormat('HH:mm'), '03:30');

  const fallBack = resolveCharterWeatherWindow({
    date: '2026-11-01',
    startTime: '01:00',
    durationMinutes: 60,
  });
  assert.strictEqual(fallBack.ok, true);
  assert.strictEqual(fallBack.durationMinutes, 60);

  const badDate = resolveCharterWeatherWindow({ date: '08-30-2026', startTime: '20:00' });
  assert.strictEqual(badDate.ok, false);
  const badTime = resolveCharterWeatherWindow({ date: '2026-08-30', startTime: '8pm' });
  assert.strictEqual(badTime.ok, false);
  const badDuration = resolveCharterWeatherWindow({
    date: '2026-08-30',
    startTime: '20:00',
    durationMinutes: 12,
  });
  assert.strictEqual(badDuration.ok, false);

  assert.strictEqual(hourlyOverlapsWindow('2026-08-30T20:00', evening.startMs, evening.endMs), true);
  assert.strictEqual(hourlyOverlapsWindow('2026-08-30T21:00', evening.startMs, evening.endMs), false);
  assert.strictEqual(hourlyOverlapsWindow('2026-08-30T23:00', midnight.startMs, midnight.endMs), true);
  assert.strictEqual(hourlyOverlapsWindow('2026-08-31T00:00', midnight.startMs, midnight.endMs), false);

  const hours = collectWindowHours(
    {
      time: ['2026-08-30T20:00', '2026-08-30T21:00', '2026-08-30T22:00'],
      weather_code: [3, 61, 3],
      temperature_2m: [82, 80, 78],
      apparent_temperature: [84, 81, 79],
      precipitation_probability: [20, 55, 10],
      precipitation: [0, 0.12, 0],
      wind_speed_10m: [8, 16, 9],
      wind_gusts_10m: [12, 26, 14],
      wind_direction_10m: [180, 200, 190],
      visibility: [16093, 1207, 16093],
      cloud_cover: [40, 90, 30],
      relative_humidity_2m: [70, 80, 75],
    },
    evening
  );
  assert.strictEqual(hours.length, 1);
  assert.strictEqual(hours[0].precipChancePct, 20);

  const twoHour = resolveCharterWeatherWindow({
    date: '2026-08-30',
    startTime: '20:00',
    durationMinutes: 120,
  });
  const multi = collectWindowHours(
    {
      time: ['2026-08-30T20:00', '2026-08-30T21:00', '2026-08-30T22:00'],
      weather_code: [3, 61, 3],
      temperature_2m: [82, 80, 78],
      apparent_temperature: [84, 81, 79],
      precipitation_probability: [20, 55, 10],
      precipitation: [0, 0.12, 0],
      wind_speed_10m: [8, 16, 9],
      wind_gusts_10m: [12, 26, 14],
      wind_direction_10m: [180, 200, 190],
      visibility: [16093, 1207, 16093],
      cloud_cover: [40, 90, 30],
      relative_humidity_2m: [70, 80, 75],
    },
    twoHour
  );
  const agg = aggregateWindowHours(multi);
  assert.strictEqual(multi.length, 2);
  assert.strictEqual(agg.precipChancePct, 55);
  assert.strictEqual(agg.windMph, 16);
  assert.strictEqual(agg.gustMph, 26);
  assert.ok(agg.visibilityMi != null && agg.visibilityMi < 1);

  const outlook = buildCharterWeatherOutlook({
    precipChancePct: agg.precipChancePct,
    precipIn: agg.precipIn,
    windMph: agg.windMph,
    gustMph: agg.gustMph,
    visibilityMi: agg.visibilityMi,
    alerts: [{ event: 'Severe Thunderstorm Warning', severity: 'Severe' }],
    hourlyCount: multi.length,
  });
  assert.strictEqual(outlook.level, 'concern');
  assert.ok(outlook.reasons.some((r) => /Rain/.test(r)));
  assert.ok(outlook.reasons.some((r) => /wind/.test(r)));
  assert.ok(outlook.reasons.some((r) => /Visibility/.test(r)));
  assert.ok(outlook.reasons.some((r) => /National Weather Service/.test(r)));

  const none = buildCharterWeatherOutlook({ hourlyCount: 0 });
  assert.strictEqual(none.level, 'unavailable');

  const fair = buildCharterWeatherOutlook({
    precipChancePct: 10,
    windMph: 8,
    gustMph: 10,
    visibilityMi: 8,
    alerts: [],
    hourlyCount: 1,
  });
  assert.strictEqual(fair.level, 'favorable');

  console.log('charterWeatherWindow.test.js: ok');
}

run();
