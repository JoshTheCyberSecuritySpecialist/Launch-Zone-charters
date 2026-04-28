const assert = require('assert');
const { DateTime } = require('luxon');

// availabilityService imports supabaseClient at module load; provide harmless test values.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.BOOKING_MIN_LEAD_HOURS = process.env.BOOKING_MIN_LEAD_HOURS || '2';

const availabilityService = require('../services/availabilityService');

function run() {
  const zone = availabilityService.BUSINESS_TZ;
  const now = DateTime.fromISO('2026-04-28T07:00:00', { zone });

  const at = (isoLocal) => DateTime.fromISO(isoLocal, { zone }).toUTC().toISO();

  // booking at exact current time should fail
  assert.strictEqual(availabilityService.isStartTimeAllowed(at('2026-04-28T07:00:00'), now), false);
  // booking 30 minutes from now should fail
  assert.strictEqual(availabilityService.isStartTimeAllowed(at('2026-04-28T07:30:00'), now), false);
  // booking 2+ hours from now should pass
  assert.strictEqual(availabilityService.isStartTimeAllowed(at('2026-04-28T09:00:00'), now), true);
  // tomorrow should still pass normally
  assert.strictEqual(availabilityService.isStartTimeAllowed(at('2026-04-29T10:00:00'), now), true);

  console.log('bookingLeadTime.test: all assertions passed');
}

run();
