'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
}

function run() {
  const ui = read('src/components/conditions/CharterTimeForecast.tsx');
  assert.ok(ui.includes('Check Times &amp; Book') || ui.includes('Check Times & Book'), ui);
  assert.ok(ui.includes('viewing weather does not reserve') || ui.includes('does not reserve that time'), ui);
  assert.ok(ui.includes('The captain makes the final operating decision'), ui);
  assert.ok(!/Guaranteed safe|Definitely cancelled|The charter will operate|The charter is cancelled/.test(ui), ui);
  assert.ok(ui.includes('/api/availability/charter/times'), 'uses real availability times');
  assert.ok(ui.includes('bookingMode'), 'preserves booking query keys');

  const service = read('server/services/charterWeatherService.js');
  assert.ok(!service.includes('process.env.WEATHER_API_KEY'), 'window forecast does not send OpenWeather secrets');
  assert.ok(service.includes('Unknown location'), service);

  console.log('charterWeatherCopy.test.js: ok');
}

run();
