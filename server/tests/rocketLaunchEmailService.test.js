'use strict';

const assert = require('assert');
const { DateTime } = require('luxon');

process.env.BUSINESS_TIMEZONE = process.env.BUSINESS_TIMEZONE || 'America/New_York';

const bookingConfirmationService = require('../services/bookingConfirmationService');
const rocketLaunchEmailService = require('../services/rocketLaunchEmailService');
const { DEPARTURE_STATUS } = require('../services/rocketDepartureService');
const { sendBookingConfirmation } = bookingConfirmationService;

function rocketBooking(overrides = {}) {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    booking_type: 'charter',
    charter_type: 'rocket',
    charter_seating: 'shared',
    is_rocket_tour: true,
    pricing_package_id: 'rocket_solo',
    pricing_package_name: 'Rocket Launch Solo',
    rental_location: null,
    start_time: DateTime.fromISO('2026-08-15T18:00', { zone: 'America/New_York' }).toUTC().toISO(),
    end_time: DateTime.fromISO('2026-08-15T21:00', { zone: 'America/New_York' }).toUTC().toISO(),
    guest_count: 1,
    package_guest_count: 1,
    status: 'confirmed',
    payment_status: 'paid',
    payment_method: 'card',
    booking_source: 'website',
    deposit_paid: 100,
    balance_due: 0,
    waiver_signed: false,
    booking_confirmation_sent_at: null,
    departure_confirmation_status: DEPARTURE_STATUS.AWAITING_MINIMUM,
    shared_departure_id: '33333333-3333-4333-8333-333333333333',
    ...overrides,
  };
}

function runSync() {
  const helpers = bookingConfirmationService.getConfirmationEmailHelpers();
  const reservation = rocketLaunchEmailService.buildRocketReservationContent({
    booking: rocketBooking(),
    customer: { full_name: 'Alex Guest', email: 'alex@example.com' },
    boat: { name: 'SunCatcher' },
    source: 'test',
    confirmationHelpers: helpers,
  });

  assert.strictEqual(reservation.subject, 'Rocket Launch Reservation Received');
  assert.ok(!reservation.textBody.includes('Your Rocket Launch Charter Is Confirmed'), reservation.textBody);
  assert.ok(!reservation.textBody.includes('Booking Confirmed'), reservation.textBody);
  assert.ok(reservation.textBody.includes('Awaiting Minimum'), reservation.textBody);
  assert.ok(reservation.textBody.includes('minimum number of booked guests'), reservation.textBody);
  assert.ok(reservation.textBody.includes('Rocket Launch Schedule Notice') || reservation.textBody.includes('launch schedule'), reservation.textBody);
  assert.ok(!reservation.textBody.includes('Parrish Park Boat Ramp'), reservation.textBody);

  const confirmed = rocketLaunchEmailService.buildRocketDepartureConfirmedContent({
    booking: rocketBooking({
      departure_confirmation_status: DEPARTURE_STATUS.DEPARTURE_CONFIRMED,
      charter_seating: 'shared',
    }),
    customer: { full_name: 'Alex Guest', email: 'alex@example.com' },
    boat: { name: 'SunCatcher' },
    source: 'test',
    confirmationHelpers: helpers,
  });

  assert.ok(confirmed.subject.includes('Your Rocket Launch Charter Is Confirmed'), confirmed.subject);
  assert.ok(confirmed.textBody.includes('fully confirmed'), confirmed.textBody);
  assert.ok(confirmed.textBody.includes('Parrish Park Boat Ramp'), confirmed.textBody);
  assert.ok(confirmed.textBody.includes('launch schedule'), confirmed.textBody);

  const privateConfirmed = rocketLaunchEmailService.buildRocketDepartureConfirmedContent({
    booking: rocketBooking({
      charter_seating: 'private',
      pricing_package_id: 'rocket_private',
      pricing_package_name: 'Private Rocket Launch',
      guest_count: 4,
      departure_confirmation_status: DEPARTURE_STATUS.DEPARTURE_CONFIRMED,
    }),
    customer: { full_name: 'Private Guest', email: 'private@example.com' },
    boat: { name: 'SunCatcher' },
    source: 'test',
    confirmationHelpers: helpers,
  });
  assert.ok(privateConfirmed.textBody.includes('Parrish Park Boat Ramp'), privateConfirmed.textBody);

  assert.strictEqual(rocketLaunchEmailService.shouldSendRocketReservationEmail(rocketBooking()), true);
  assert.strictEqual(
    rocketLaunchEmailService.shouldSendRocketDepartureConfirmedEmail(
      rocketBooking({ departure_confirmation_status: DEPARTURE_STATUS.DEPARTURE_CONFIRMED })
    ),
    true
  );
  assert.strictEqual(
    rocketLaunchEmailService.shouldSendRocketDepartureConfirmedEmail(
      rocketBooking({ charter_seating: 'private', departure_confirmation_status: DEPARTURE_STATUS.DEPARTURE_CONFIRMED })
    ),
    true
  );

  console.log('rocketLaunchEmailService.test: sync assertions passed');
}

async function runAsync() {
  let sendCount = 0;
  const sentSubjects = [];

  const fakeResend = {
    emails: {
      send: async (payload) => {
        sendCount += 1;
        sentSubjects.push(payload.subject);
        return { data: { id: `msg_${sendCount}` }, error: null };
      },
    },
  };

  const bookingRow = rocketBooking();
  const commRows = [];
  const supabase = {
    from(table) {
      let filters = {};
      const api = {
        select() {
          return api;
        },
        eq(column, value) {
          filters[column] = value;
          return api;
        },
        in() {
          return api;
        },
        is() {
          return api;
        },
        order() {
          return api;
        },
        limit() {
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
                customers: { full_name: 'Alex Guest', email: 'alex@example.com' },
                boats: { name: 'SunCatcher' },
              },
              error: null,
            };
          }
          if (table === 'booking_communications') {
            const match = [...commRows]
              .reverse()
              .find((row) =>
                Object.entries(filters).every(([column, value]) => row[column] === value)
              );
            filters = {};
            return { data: match || null, error: null };
          }
          filters = {};
          return { data: null, error: null };
        },
        insert(row) {
          const entry = Array.isArray(row) ? row[0] : row;
          if (table === 'booking_communications') {
            commRows.push({ id: `comm-${commRows.length + 1}`, ...entry });
          }
          return {
            select() {
              return {
                single: async () => ({ data: commRows[commRows.length - 1], error: null }),
              };
            },
          };
        },
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
  assert.strictEqual(sendCount, 1);
  assert.strictEqual(sentSubjects[0], 'Rocket Launch Reservation Received');
  assert.strictEqual(commRows.length, 1);
  assert.strictEqual(commRows[0].message_type, 'rocket_launch_reservation_received');

  await sendBookingConfirmation({
    supabase,
    resend: fakeResend,
    resendFrom: 'Launch Zone <test@example.com>',
    bookingId: bookingRow.id,
    source: 'test_retry',
    verifyEmailMatch: false,
  });
  assert.strictEqual(sendCount, 1, 'reservation email must be idempotent');

  bookingRow.departure_confirmation_status = DEPARTURE_STATUS.DEPARTURE_CONFIRMED;
  await sendBookingConfirmation({
    supabase,
    resend: fakeResend,
    resendFrom: 'Launch Zone <test@example.com>',
    bookingId: bookingRow.id,
    source: 'test_confirmed',
    verifyEmailMatch: false,
  });
  assert.strictEqual(sendCount, 2);
  assert.ok(sentSubjects[1].includes('Your Rocket Launch Charter Is Confirmed'), sentSubjects[1]);
  assert.strictEqual(commRows[1].message_type, 'rocket_launch_departure_confirmed');

  await sendBookingConfirmation({
    supabase,
    resend: fakeResend,
    resendFrom: 'Launch Zone <test@example.com>',
    bookingId: bookingRow.id,
    source: 'test_confirmed_retry',
    verifyEmailMatch: false,
  });
  assert.strictEqual(sendCount, 2, 'departure confirmed email must be idempotent');

  console.log('rocketLaunchEmailService.test: async assertions passed');
}

runSync();
runAsync().catch((err) => {
  console.error(err);
  process.exit(1);
});
