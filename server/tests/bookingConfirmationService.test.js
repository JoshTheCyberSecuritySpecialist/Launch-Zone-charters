'use strict';

const assert = require('assert');
const { DateTime } = require('luxon');

process.env.BUSINESS_TIMEZONE = process.env.BUSINESS_TIMEZONE || 'America/New_York';

const {
  buildConfirmationContent,
  googleMapsDirectionsUrl,
  resolveMeetingLocation,
  sendBookingConfirmation,
  TITUSVILLE_MEETING_LOCATION,
} = require('../services/bookingConfirmationService');
const { locationText } = require('../lib/meetingLocations');

function bioBooking(overrides = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    booking_type: 'charter',
    charter_type: 'bio',
    is_night_tour: true,
    rental_location: null,
    start_time: DateTime.fromISO('2026-07-02T20:00', { zone: 'America/New_York' }).toUTC().toISO(),
    end_time: DateTime.fromISO('2026-07-02T21:00', { zone: 'America/New_York' }).toUTC().toISO(),
    guest_count: 2,
    status: 'confirmed',
    payment_status: 'paid',
    payment_method: 'card',
    booking_source: 'website',
    deposit_paid: 150,
    balance_due: 0,
    waiver_signed: false,
    license_status: 'verified',
    insurance_status: 'verified',
    captain_included: true,
    ...overrides,
  };
}

function run() {
  process.env.APP_PUBLIC_URL = process.env.APP_PUBLIC_URL || 'https://launchzonecharters.com';
  const meeting = resolveMeetingLocation(bioBooking());
  assert.strictEqual(meeting.id, 'parrish_park');
  assert.strictEqual(meeting.name, 'Parrish Park Boat Ramp');
  assert.strictEqual(meeting.address1, '1 A. Max Brewer Memorial Pkwy');
  assert.strictEqual(meeting.city, 'Titusville');
  assert.strictEqual(meeting.postalCode, '32796');

  const mapsUrl = googleMapsDirectionsUrl(TITUSVILLE_MEETING_LOCATION);
  assert.ok(mapsUrl.includes('google.com/maps/dir/'), mapsUrl);
  assert.ok(mapsUrl.includes(encodeURIComponent('1 A. Max Brewer Memorial Pkwy')), mapsUrl);
  assert.ok(mapsUrl.includes(encodeURIComponent('Titusville')), mapsUrl);
  assert.ok(mapsUrl.includes(encodeURIComponent('32796')), mapsUrl);

  const content = buildConfirmationContent({
    booking: bioBooking(),
    customer: { full_name: 'Jamie Example', email: 'jamie@example.com' },
    boat: { name: 'Premium Center Console' },
    source: 'stripe_finalize',
  });

  assert.ok(content.subject.includes('Confirmed'), content.subject);
  assert.ok(content.textBody.includes('Parrish Park Boat Ramp'), content.textBody);
  assert.ok(content.textBody.includes('1 A. Max Brewer Memorial Pkwy'), content.textBody);
  assert.ok(content.textBody.includes('Titusville, FL 32796'), content.textBody);
  assert.ok(content.textBody.includes('Meet us by the docks/boat ramp'), content.textBody);
  assert.ok(content.textBody.includes('8:00 PM'), content.textBody);
  assert.ok(content.textBody.includes('Guests: 2'), content.textBody);
  assert.ok(content.textBody.includes("YOU'RE BOOKED!"), content.textBody);
  assert.ok(content.textBody.includes('Duration: 1 Hour'), content.textBody);
  assert.ok(content.textBody.includes('Paid: $150.00'), content.textBody);
  assert.ok(content.textBody.includes('Reservation #LZC-1111'), content.textBody);
  assert.ok(content.textBody.includes('IMPORTANT — WHERE TO MEET'), content.textBody);
  assert.ok(content.textBody.includes('Complete Waiver:'), content.textBody);
  assert.ok(!content.textBody.includes("driver's license"), content.textBody);
  assert.ok(!content.textBody.includes('rental insurance'), content.textBody);
  assert.ok(content.htmlBody.includes('Get Directions'), content.htmlBody);
  assert.ok(content.htmlBody.includes('Complete Waiver'), content.htmlBody);
  assert.ok(content.htmlBody.includes(encodeURIComponent('Parrish Park Boat Ramp')), content.htmlBody);

  const grouponContent = buildConfirmationContent({
    booking: bioBooking({ booking_source: 'groupon', payment_method: 'groupon', deposit_paid: 0 }),
    customer: { full_name: 'Groupon Guest', email: 'guest@example.com' },
    boat: null,
    source: 'groupon_approval',
  });
  assert.ok(grouponContent.textBody.includes('Paid through Groupon'), grouponContent.textBody);
  assert.ok(!grouponContent.textBody.includes('Deposit paid: $0.00'), grouponContent.textBody);

  const portOrangeRental = resolveMeetingLocation({
    booking_type: 'rental',
    rental_location: 'port-orange',
    charter_type: null,
  });
  assert.strictEqual(portOrangeRental.id, 'port_orange');
  assert.notStrictEqual(portOrangeRental.address1, TITUSVILLE_MEETING_LOCATION.address1);

  assert.strictEqual(
    locationText(TITUSVILLE_MEETING_LOCATION).includes('Parrish Park Boat Ramp'),
    true
  );

  console.log('bookingConfirmationService.test: synchronous assertions passed');
}

async function runAsync() {
  let sendCount = 0;
  const fakeResend = {
    emails: {
      send: async () => {
        sendCount += 1;
        return { data: { id: `msg_${sendCount}` }, error: null };
      },
    },
  };

  const bookingRow = bioBooking({ booking_confirmation_sent_at: null });
  const supabase = {
    from(table) {
      const api = {
        select() {
          return api;
        },
        eq() {
          return api;
        },
        is() {
          return api;
        },
        update() {
          return api;
        },
        maybeSingle: async () => {
          if (table === 'bookings') {
            return {
              data: {
                ...bookingRow,
                customers: { full_name: 'Jamie Example', email: 'jamie@example.com' },
                boats: { name: 'Boat 1' },
              },
              error: null,
            };
          }
          return { data: null, error: null };
        },
        insert: async () => ({ data: { id: 'comm-1' }, error: null }),
      };
      return api;
    },
  };

  await sendBookingConfirmation({
    supabase,
    resend: fakeResend,
    resendFrom: 'Launch Zone <test@example.com>',
    bookingId: bookingRow.id,
    source: 'test',
    verifyEmailMatch: false,
  });
  assert.strictEqual(sendCount, 1, 'first send');

  bookingRow.booking_confirmation_sent_at = new Date().toISOString();
  await sendBookingConfirmation({
    supabase,
    resend: fakeResend,
    resendFrom: 'Launch Zone <test@example.com>',
    bookingId: bookingRow.id,
    source: 'test_retry',
    verifyEmailMatch: false,
  });
  assert.strictEqual(sendCount, 1, 'duplicate webhook retry must not send again');

  await sendBookingConfirmation({
    supabase,
    resend: fakeResend,
    resendFrom: 'Launch Zone <test@example.com>',
    bookingId: bookingRow.id,
    source: 'admin_resend',
    forceResend: true,
    verifyEmailMatch: false,
  });
  assert.strictEqual(sendCount, 2, 'admin force resend sends intentionally');

  const unpaidHold = bioBooking({
    status: 'pending',
    payment_status: 'pending',
    deposit_paid: 0,
    stripe_checkout_session_id: 'cs_test_unpaid_hold',
    booking_confirmation_sent_at: null,
  });
  Object.assign(bookingRow, unpaidHold);
  await assert.rejects(
    () =>
      sendBookingConfirmation({
        supabase,
        resend: fakeResend,
        resendFrom: 'Launch Zone <test@example.com>',
        bookingId: unpaidHold.id,
        source: 'test_hold',
        verifyEmailMatch: false,
      }),
    (err) => err.statusCode === 400 && /Payment not completed/.test(err.message)
  );
  assert.strictEqual(sendCount, 2, 'unpaid website checkout hold must not send confirmation');

  console.log('bookingConfirmationService.test: async idempotency assertions passed');
}

run();
runAsync().catch((err) => {
  console.error(err);
  process.exit(1);
});
