'use strict';

/**
 * Fill-forward shared bio + bio_private capacity rules.
 */
process.env.DIRECT_BIO_PACKAGE_PRICING_ENABLED = 'true';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.BUSINESS_TIMEZONE = process.env.BUSINESS_TIMEZONE || 'America/New_York';

const assert = require('assert');
const { DateTime } = require('luxon');
const {
  applyBioSharedFillForward,
  selectFillForwardTarget,
  isRequestedStartFillForwardTarget,
} = require('../services/bioSharedFillForward');
const {
  evaluateSharedCharterCapacity,
  isSharedCharterBooking,
  bookingRowBlocksSlot,
} = require('../lib/sharedCharterCapacity');
const { getBioluminescencePackage } = require('../config/bioluminescencePackages');
const {
  validateDirectBioPackageCheckout,
  bioPackageExpectedTotals,
} = require('../services/bioluminescencePackagePricing');
const availabilityService = require('../services/availabilityService');

const ZONE = 'America/New_York';

function localToUtcIso(localIso) {
  return DateTime.fromISO(localIso, { zone: ZONE }).toUTC().toISO();
}

function slot(localStart, capacity) {
  const start = localToUtcIso(localStart);
  const end = DateTime.fromISO(localStart, { zone: ZONE }).plus({ hours: 1 }).toUTC().toISO();
  return {
    start,
    end,
    startHHMM: DateTime.fromISO(localStart, { zone: ZONE }).toFormat('HH:mm'),
    label: DateTime.fromISO(localStart, { zone: ZONE }).toFormat('h:mm a'),
    available: true,
    capacity,
  };
}

function bookingRow(partial) {
  return {
    id: partial.id || 'b1',
    status: partial.status || 'confirmed',
    booking_type: 'charter',
    charter_type: partial.charter_type || 'bio',
    charter_seating: partial.charter_seating ?? 'shared',
    pricing_package_id: partial.pricing_package_id || null,
    boat_id: partial.boat_id || 'boat-1',
    guest_count: partial.guest_count,
    start_time: partial.start_time,
    end_time: partial.end_time,
    expires_at: partial.expires_at ?? null,
    hold_expires_at: partial.hold_expires_at ?? null,
  };
}

function run() {
  const eight = slot('2026-07-10T20:00', { used: 0, remaining: 5, max: 5 });
  const nine = slot('2026-07-10T21:00', { used: 0, remaining: 5, max: 5 });
  const ten = slot('2026-07-10T22:00', { used: 0, remaining: 5, max: 5 });

  // 1–2: empty night opens earliest only
  let target = selectFillForwardTarget([eight, nine, ten]);
  assert.strictEqual(target.start, eight.start);
  let filtered = applyBioSharedFillForward([eight, nine, ten]);
  assert.strictEqual(filtered.length, 1);
  assert.strictEqual(filtered[0].start, eight.start);

  // 1: 2-person shared leaves 3 seats; later hours hidden
  const eightPartial = slot('2026-07-10T20:00', { used: 2, remaining: 3, max: 5 });
  filtered = applyBioSharedFillForward([eightPartial, nine, ten]);
  assert.strictEqual(filtered.length, 1);
  assert.strictEqual(filtered[0].start, eightPartial.start);
  assert.strictEqual(filtered[0].capacity.remaining, 3);

  // 3: another party can fill remaining seats (capacity math)
  let cap = evaluateSharedCharterCapacity({
    overlappingBookings: [
      bookingRow({
        id: 'party-a',
        guest_count: 2,
        pricing_package_id: 'bio_two',
        start_time: eightPartial.start,
        end_time: eightPartial.end,
      }),
    ],
    proposedGuestCount: 3,
  });
  assert.strictEqual(cap.available, true);
  assert.strictEqual(cap.capacity.remaining, 0);

  // 4: next hour opens at 5 reserved
  const eightFullGone = [nine, ten];
  filtered = applyBioSharedFillForward(eightFullGone);
  assert.strictEqual(filtered[0].start, nine.start);

  // 5: expired / canceled holds release capacity
  assert.strictEqual(
    bookingRowBlocksSlot(
      bookingRow({
        status: 'pending',
        guest_count: 5,
        expires_at: '2000-01-01T00:00:00.000Z',
        start_time: eight.start,
        end_time: eight.end,
      })
    ),
    false
  );
  assert.strictEqual(
    bookingRowBlocksSlot(
      bookingRow({
        status: 'cancelled',
        guest_count: 5,
        start_time: eight.start,
        end_time: eight.end,
      })
    ),
    false
  );
  cap = evaluateSharedCharterCapacity({
    overlappingBookings: [
      bookingRow({
        status: 'pending',
        guest_count: 5,
        expires_at: '2000-01-01T00:00:00.000Z',
        start_time: eight.start,
        end_time: eight.end,
      }),
      bookingRow({
        status: 'cancelled',
        guest_count: 5,
        start_time: eight.start,
        end_time: eight.end,
      }),
    ],
    proposedGuestCount: 2,
  });
  assert.strictEqual(cap.available, true);
  assert.strictEqual(cap.capacity.used, 0);

  // 6: private 1–5 guests same $249.99
  const priv = getBioluminescencePackage('bio_private');
  assert.strictEqual(priv.priceCents, 24999);
  for (const guests of [1, 2, 3, 4, 5]) {
    const check = validateDirectBioPackageCheckout({
      charterType: 'bio',
      pricingPackageId: 'bio_private',
      passengerCountFromClient: guests,
      bookingSource: 'website',
    });
    assert.strictEqual(check.ok, true, `private ${guests} guests`);
    assert.strictEqual(check.passengerCount, guests);
    assert.strictEqual(check.charterVariant, 'private');
    const totals = bioPackageExpectedTotals(priv, { passengerCount: guests });
    assert.strictEqual(totals.totalPrice, 249.99);
    assert.strictEqual(totals.guestCount, guests);
  }

  // 7: private reserves all 5 seats
  assert.strictEqual(
    isSharedCharterBooking(
      bookingRow({
        pricing_package_id: 'bio_private',
        charter_seating: 'private',
        guest_count: 2,
      })
    ),
    false
  );
  cap = evaluateSharedCharterCapacity({
    overlappingBookings: [
      bookingRow({
        id: 'private-1',
        pricing_package_id: 'bio_private',
        charter_seating: 'private',
        guest_count: 2,
        start_time: eight.start,
        end_time: eight.end,
      }),
    ],
    proposedGuestCount: 1,
  });
  assert.strictEqual(cap.available, false);
  assert.strictEqual(cap.reason, 'exclusive_conflict');

  // 8: shared and private cannot share a time
  cap = evaluateSharedCharterCapacity({
    overlappingBookings: [
      bookingRow({
        id: 'shared-1',
        pricing_package_id: 'bio_two',
        guest_count: 2,
        start_time: eight.start,
        end_time: eight.end,
      }),
    ],
    proposedGuestCount: 1,
  });
  assert.strictEqual(cap.available, true);
  // private path uses exclusive boat check — shared occupancy blocks via exclusive? 
  // Shared rows are not exclusive; private booking uses checkBookingSlotAvailability.
  // Capacity helper: proposing shared while private exists:
  cap = evaluateSharedCharterCapacity({
    overlappingBookings: [
      bookingRow({
        id: 'private-2',
        pricing_package_id: 'bio_private',
        charter_seating: 'private',
        guest_count: 1,
        start_time: eight.start,
        end_time: eight.end,
      }),
    ],
    proposedGuestCount: 1,
  });
  assert.strictEqual(cap.available, false);

  // 9: private customers are not limited by fill-forward (shared listing still fill-forwards)
  assert.strictEqual(
    availabilityService.isSharedCharterBookingRequest({
      charterType: 'bio',
      bioPackage: priv,
      charterVariant: 'private',
    }),
    false
  );
  assert.strictEqual(
    availabilityService.isSharedCharterBookingRequest({
      charterType: 'bio',
      bioPackage: getBioluminescencePackage('bio_two'),
    }),
    true
  );
  assert.strictEqual(
    availabilityService.resolveCharterSeatingForInsert({
      charterType: 'bio',
      bioPackage: priv,
    }),
    'private'
  );

  // Stale shared time rejected by fill-forward helper
  assert.strictEqual(
    isRequestedStartFillForwardTarget([eightPartial, nine], nine.start),
    false
  );
  assert.strictEqual(
    isRequestedStartFillForwardTarget([eightPartial, nine], eightPartial.start),
    true
  );

  // 10: concurrent overbooking — third party cannot exceed 5
  cap = evaluateSharedCharterCapacity({
    overlappingBookings: [
      bookingRow({ id: 'a', guest_count: 2, start_time: eight.start, end_time: eight.end }),
      bookingRow({ id: 'b', guest_count: 3, start_time: eight.start, end_time: eight.end }),
    ],
    proposedGuestCount: 1,
  });
  assert.strictEqual(cap.available, false);
  assert.strictEqual(cap.reason, 'charter_capacity');

  // 11: after-midnight operating date (1 AM belongs to previous evening anchor)
  const oneAm = slot('2026-07-11T01:00', { used: 1, remaining: 4, max: 5 });
  const friEight = slot('2026-07-10T20:00', { used: 0, remaining: 5, max: 5 });
  filtered = applyBioSharedFillForward([friEight, oneAm]);
  // Same operating night: partial 1am wins over empty 8pm? 
  // 1am is later; if 1am has guests, it's the fill target for that night.
  // friEight and oneAm share Friday operating night (Jul 10).
  assert.strictEqual(filtered.length, 1);
  assert.strictEqual(filtered[0].start, oneAm.start);

  // 12: mis-tagged shared bio still shares (admin/staff-safe legacy)
  assert.strictEqual(
    isSharedCharterBooking(
      bookingRow({
        charter_type: 'bio',
        charter_seating: 'private',
        pricing_package_id: 'bio_two',
        guest_count: 2,
      })
    ),
    true
  );
  assert.strictEqual(
    availabilityService.isSharedCharterBookingRequest({
      charterType: 'bio',
      charterVariant: 'private',
      bioPackage: getBioluminescencePackage('bio_solo'),
    }),
    true
  );

  // 13: existing shared package prices unchanged
  assert.strictEqual(getBioluminescencePackage('bio_solo').priceCents, 4499);
  assert.strictEqual(getBioluminescencePackage('bio_two').priceCents, 8999);
  assert.strictEqual(getBioluminescencePackage('bio_three').priceCents, 13499);
  assert.strictEqual(getBioluminescencePackage('bio_four').priceCents, 17999);

  console.log('bioSharedFillForward.test.js: all tests passed');
}

run();
