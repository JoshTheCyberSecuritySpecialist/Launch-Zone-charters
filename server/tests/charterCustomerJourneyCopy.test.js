'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
}

function run() {
  const waivers = read('src/pages/WaiversInsurance.tsx');
  assert.ok(!waivers.includes('Continue Without Booking'), 'direct customers must not see Continue Without Booking');
  assert.ok(waivers.includes('Continue with Partner Booking'), waivers);
  assert.ok(waivers.includes("We couldn't find your reservation yet."), waivers);
  assert.ok(waivers.includes('license, and insurance steps') === false, waivers);

  const manual = read('src/components/booking/ManualPreTripSubmission.tsx');
  assert.ok(manual.includes("Select what you booked"), manual);
  assert.ok(manual.includes("Captain-led charters do not need"), manual);

  const bookNow = read('src/pages/BookNow.tsx');
  assert.ok(bookNow.includes('That departure was just booked.'), bookNow);
  assert.ok(bookNow.includes('Here are the closest available times:'), bookNow);
  assert.ok(bookNow.includes('Night glow on the lagoon · {formatCharterDurationLabel()}'), bookNow);

  const success = read('src/pages/BookingSuccess.tsx');
  assert.ok(success.includes('Important — where to meet'), success);
  assert.ok(success.includes('Complete Waiver'), success);
  assert.ok(success.includes('Get Directions'), success);
  assert.ok(!success.includes('Booking ID'), success);

  const email = read('server/services/bookingConfirmationService.js');
  assert.ok(email.includes("YOU'RE BOOKED!"), email);
  assert.ok(email.includes('IMPORTANT — WHERE TO MEET'), email);
  assert.ok(email.includes('Complete Waiver'), email);

  console.log('charterCustomerJourneyCopy.test.js: ok');
}

run();
