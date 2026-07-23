const assert = require('assert');
const captainBookingService = require('../services/captainBookingService');

function run() {
  assert.strictEqual(captainBookingService.paymentDisplayStatus({ payment_status: 'paid' }), 'Ready');
  assert.strictEqual(
    captainBookingService.paymentDisplayStatus({ payment_status: 'pending', status: 'confirmed' }),
    'Ready'
  );
  assert.strictEqual(
    captainBookingService.paymentDisplayStatus({ payment_status: 'pending', status: 'pending' }),
    'Action Required'
  );

  const arrived = captainBookingService.resolveProgressUpdate('not_started', 'arrived');
  assert.strictEqual(arrived.nextProgress, 'arrived');

  const started = captainBookingService.resolveProgressUpdate('arrived', 'start');
  assert.strictEqual(started.nextProgress, 'in_progress');

  const completed = captainBookingService.resolveProgressUpdate('in_progress', 'complete');
  assert.strictEqual(completed.nextProgress, 'completed');

  assert.throws(() => captainBookingService.resolveProgressUpdate('not_started', 'start'), (err) => {
    assert.strictEqual(err.statusCode, 422);
    return true;
  });

  assert.throws(() => captainBookingService.resolveProgressUpdate('arrived', 'arrived'), (err) => {
    assert.strictEqual(err.statusCode, 422);
    return true;
  });

  const sanitized = captainBookingService.sanitizeBookingDetail(
    {
      id: '11111111-1111-4111-8111-111111111111',
      start_time: '2026-07-23T21:00:00.000Z',
      end_time: '2026-07-24T01:00:00.000Z',
      status: 'confirmed',
      captain_progress: 'not_started',
      guest_count: 4,
      rental_location: 'Titusville',
      charter_type: 'captain_charter',
      booking_type: 'charter',
      special_requests: 'Birthday',
      staff_notes: null,
      emergency_contact_notes: 'Jane Doe (spouse) 555-0100',
      waiver_signed: true,
      license_status: 'verified',
      insurance_status: 'verified',
      payment_status: 'paid',
      customers: { full_name: 'Alex Guest', phone: '555-0200', email: 'guest@example.com' },
      boats: { id: '22222222-2222-4222-8222-222222222222', name: 'Sea Breeze', type: 'premium' },
      captains: { id: '33333333-3333-4333-8333-333333333333', full_name: 'Captain Pat' },
    },
    [{ passenger_number: 1, passenger_name: 'Alex Guest', passenger_type: 'adult', mobility_assistance_required: false, mobility_notes: null }],
    'within_operating_range'
  );

  assert.strictEqual(sanitized.customer.phone, '555-0200');
  assert.strictEqual(sanitized.emergency_contact_notes, 'Jane Doe (spouse) 555-0100');
  assert.strictEqual(sanitized.payment_display, 'Ready');
  assert.strictEqual(sanitized.passengers.length, 1);
  assert.strictEqual(sanitized.verification_summary.payment_display, 'Ready');
  assert.ok(!Object.prototype.hasOwnProperty.call(sanitized, 'admin_notes'));
  assert.ok(!Object.prototype.hasOwnProperty.call(sanitized, 'stripe_payment_id'));

  console.log('captainBookingService.test: all assertions passed');
}

run();
