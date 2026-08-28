'use strict';

process.env.DIRECT_BIO_PACKAGE_PRICING_ENABLED = 'true';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { DateTime } = require('luxon');
const {
  BIO_FIFTH_PASSENGER_ADDON_CENTS,
  BIO_FIFTH_PASSENGER_ADDON_PACKAGE_ID,
  BIO_FOUR_SIDEBAR_FIVE_LABEL,
  BIO_FOUR_SIDEBAR_INCLUDED_LABEL,
  bioPackageAllowsFifthPassengerAddon,
  getBioluminescencePackage,
} = require('../config/bioluminescencePackages');
const {
  bioPackageBookingFields,
  bioPackageExpectedTotals,
  extractFifthPassengerAddonFromBooking,
  resolveCharterBioPricing,
  stripeLineItemNameForBioPackage,
  stripeLineItemsForBioPackage,
  validateDirectBioPackageCheckout,
} = require('../services/bioluminescencePackagePricing');
const { evaluateSharedCharterCapacity } = require('../lib/sharedCharterCapacity');

function fourPkg() {
  return getBioluminescencePackage('bio_four');
}

function runCatalogTests() {
  const four = fourPkg();
  assert.strictEqual(four.id, BIO_FIFTH_PASSENGER_ADDON_PACKAGE_ID);
  assert.strictEqual(four.guestCount, 4);
  assert.strictEqual(four.priceCents, 17999);
  assert.strictEqual(four.allowsFifthPassengerAddon, true);
  assert.strictEqual(BIO_FIFTH_PASSENGER_ADDON_CENTS, 4500);
  assert.strictEqual(bioPackageAllowsFifthPassengerAddon(four), true);
  assert.strictEqual(bioPackageAllowsFifthPassengerAddon(getBioluminescencePackage('bio_solo')), false);
  assert.strictEqual(bioPackageAllowsFifthPassengerAddon(getBioluminescencePackage('bio_two')), false);
  assert.strictEqual(bioPackageAllowsFifthPassengerAddon(getBioluminescencePackage('bio_three')), false);
}

function runPricingWithoutAddon() {
  const totals = bioPackageExpectedTotals(fourPkg());
  assert.strictEqual(totals.guestCount, 4);
  assert.strictEqual(Math.round(totals.amountDueToday * 100), 17999);
  assert.strictEqual(totals.fifthPassengerAddon, false);

  const fields = bioPackageBookingFields(fourPkg());
  assert.strictEqual(fields.package_guest_count, 4);
  assert.strictEqual(fields.final_amount_cents, 17999);

  const items = stripeLineItemsForBioPackage(fourPkg());
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].unit_amount, 17999);
}

function runPricingWithAddon() {
  const totals = bioPackageExpectedTotals(fourPkg(), { fifthPassengerAddon: true });
  assert.strictEqual(totals.guestCount, 5);
  assert.strictEqual(totals.fifthPassengerAddon, true);
  assert.strictEqual(totals.fifthPassengerAddonCents, 4500);
  assert.strictEqual(Math.round(totals.amountDueToday * 100), 22499);
  assert.strictEqual(totals.totalPrice, 224.99);

  const fields = bioPackageBookingFields(fourPkg(), { fifthPassengerAddon: true });
  assert.strictEqual(fields.package_guest_count, 5);
  assert.strictEqual(fields.final_amount_cents, 22499);
  assert.strictEqual(fields.package_price_cents, 22499);

  const items = stripeLineItemsForBioPackage(fourPkg(), { fifthPassengerAddon: true });
  assert.strictEqual(items.length, 2);
  assert.strictEqual(items[0].unit_amount, 17999);
  assert.strictEqual(items[1].unit_amount, 4500);
  assert.strictEqual(items[1].name, 'Additional 5th passenger');
  assert.strictEqual(
    items.reduce((sum, item) => sum + item.unit_amount, 0),
    22499
  );
  assert.match(stripeLineItemNameForBioPackage(fourPkg(), { fifthPassengerAddon: true }), /5 Guests/);
}

function runValidationTests() {
  const withAddon = validateDirectBioPackageCheckout({
    charterType: 'bio',
    pricingPackageId: 'bio_four',
    passengerCountFromClient: 4,
    bookingSource: 'website',
    fifthPassengerAddonFromClient: true,
  });
  assert.strictEqual(withAddon.ok, true);
  assert.strictEqual(withAddon.passengerCount, 5);
  assert.strictEqual(withAddon.fifthPassengerAddon, true);

  const withFive = validateDirectBioPackageCheckout({
    charterType: 'bio',
    pricingPackageId: 'bio_four',
    passengerCountFromClient: 5,
    bookingSource: 'website',
    fifthPassengerAddonFromClient: true,
  });
  assert.strictEqual(withFive.ok, true);
  assert.strictEqual(withFive.passengerCount, 5);

  const withoutAddon = validateDirectBioPackageCheckout({
    charterType: 'bio',
    pricingPackageId: 'bio_four',
    passengerCountFromClient: 4,
    bookingSource: 'website',
    fifthPassengerAddonFromClient: false,
  });
  assert.strictEqual(withoutAddon.ok, true);
  assert.strictEqual(withoutAddon.passengerCount, 4);
  assert.strictEqual(withoutAddon.fifthPassengerAddon, false);

  const fiveWithoutFlag = validateDirectBioPackageCheckout({
    charterType: 'bio',
    pricingPackageId: 'bio_four',
    passengerCountFromClient: 5,
    bookingSource: 'website',
  });
  assert.strictEqual(fiveWithoutFlag.ok, false);

  const sixGuests = validateDirectBioPackageCheckout({
    charterType: 'bio',
    pricingPackageId: 'bio_four',
    passengerCountFromClient: 6,
    bookingSource: 'website',
    fifthPassengerAddonFromClient: true,
  });
  assert.strictEqual(sixGuests.ok, false);

  for (const id of ['bio_solo', 'bio_two', 'bio_three']) {
    const rejected = validateDirectBioPackageCheckout({
      charterType: 'bio',
      pricingPackageId: id,
      passengerCountFromClient: 1,
      bookingSource: 'website',
      fifthPassengerAddonFromClient: true,
    });
    assert.strictEqual(rejected.ok, false, `${id} must reject fifth-passenger add-on`);
  }
}

function runTamperAndResolveTests() {
  assert.strictEqual(
    extractFifthPassengerAddonFromBooking({ fifthPassengerAddon: true, total_price: 1 }),
    true
  );
  assert.strictEqual(extractFifthPassengerAddonFromBooking({ total_price: 224.99 }), false);

  const resolved = resolveCharterBioPricing({
    charterType: 'bio',
    pricingPackageId: 'bio_four',
    passengerCount: 4,
    bookingSource: 'website',
    fifthPassengerAddon: true,
  });
  assert.strictEqual(resolved.kind, 'package');
  assert.strictEqual(resolved.passengerCount, 5);
  assert.strictEqual(Math.round(resolved.totals.amountDueToday * 100), 22499);
  assert.notStrictEqual(resolved.totals.totalPrice, 1);

  const fakePriceIgnored = resolveCharterBioPricing({
    charterType: 'bio',
    pricingPackageId: 'bio_four',
    passengerCount: 5,
    bookingSource: 'website',
    fifthPassengerAddon: false,
  });
  assert.strictEqual(fakePriceIgnored.kind, 'error');
}

function runCapacityTests() {
  const zone = 'America/New_York';
  const start = DateTime.fromISO('2026-07-02T21:00', { zone }).toUTC().toISO();
  const end = DateTime.fromISO('2026-07-02T22:00', { zone }).toUTC().toISO();
  const row = (id, guest_count) => ({
    id,
    status: 'confirmed',
    booking_type: 'charter',
    charter_type: 'bio',
    charter_seating: 'shared',
    boat_id: 'boat-1',
    guest_count,
    start_time: start,
    end_time: end,
    expires_at: null,
  });

  const emptyFive = evaluateSharedCharterCapacity({
    overlappingBookings: [],
    proposedGuestCount: 5,
  });
  assert.strictEqual(emptyFive.available, true);
  assert.strictEqual(emptyFive.capacity.remaining, 0);
  assert.strictEqual(emptyFive.capacity.requested, 5);

  const fiveConsumesBoat = evaluateSharedCharterCapacity({
    overlappingBookings: [row('five', 5)],
    proposedGuestCount: 1,
  });
  assert.strictEqual(fiveConsumesBoat.available, false);

  const oneSeatLeft = evaluateSharedCharterCapacity({
    overlappingBookings: [row('four', 4)],
    proposedGuestCount: 5,
  });
  assert.strictEqual(oneSeatLeft.available, false);

  const fourPlusSolo = evaluateSharedCharterCapacity({
    overlappingBookings: [row('four', 4)],
    proposedGuestCount: 1,
  });
  assert.strictEqual(fourPlusSolo.available, true);

  const aboveFive = evaluateSharedCharterCapacity({
    overlappingBookings: [],
    proposedGuestCount: 6,
  });
  assert.strictEqual(aboveFive.available, false);
}

function runDisplayCopyTests() {
  assert.strictEqual(BIO_FOUR_SIDEBAR_INCLUDED_LABEL, '4 passengers included.');
  assert.strictEqual(BIO_FOUR_SIDEBAR_FIVE_LABEL, '5 passengers.');

  const frontend = fs.readFileSync(
    path.join(__dirname, '../../src/lib/bioluminescencePackages.ts'),
    'utf8'
  );
  assert.ok(frontend.includes("4 passengers included."));
  assert.ok(frontend.includes("5 passengers."));
  assert.ok(frontend.includes('This departure does not have room for a fifth passenger.'));

  const bookNow = fs.readFileSync(path.join(__dirname, '../../src/pages/BookNow.tsx'), 'utf8');
  assert.ok(bookNow.includes('Add a 5th passenger'));
  assert.ok(bookNow.includes('Maximum capacity: 5 guests'));
  assert.ok(!/Need to book for five guests\?/.test(bookNow));
  assert.ok(bookNow.includes('bioFourSidebarPassengerLine'));

  const base = 179.99;
  const off = { guests: 4, total: Number((base + 0).toFixed(2)), per: (base / 4).toFixed(2) };
  const on = { guests: 5, total: Number((base + 45).toFixed(2)), per: ((base + 45) / 5).toFixed(2) };
  assert.strictEqual(off.total, 179.99);
  assert.strictEqual(off.per, '45.00');
  assert.strictEqual(on.total, 224.99);
  assert.strictEqual(on.per, '45.00');
  assert.notStrictEqual(off.guests, on.guests);
}

function runConfirmationAndWebhookShapeTests() {
  const { templateFor } = require('../services/bookingCommunications');
  const fields = bioPackageBookingFields(fourPkg(), { fifthPassengerAddon: true });
  const detail = {
    booking: {
      id: '00000000-0000-4000-8000-000000000005',
      charter_type: 'bio',
      pricing_package_id: fields.pricing_package_id,
      pricing_package_name: fields.pricing_package_name,
      guest_count: 5,
      package_guest_count: fields.package_guest_count,
      final_amount_cents: fields.final_amount_cents,
      start_time: '2026-08-01T01:00:00.000Z',
      end_time: '2026-08-01T02:00:00.000Z',
      total_price: 224.99,
      final_total: 224.99,
      payment_status: 'paid',
      balance_due: 0,
      rental_location: 'Titusville',
      customers: { full_name: 'Five Guest', email: 'five@example.com', phone: '8035421761' },
      boats: { name: 'Lagoon Boat' },
    },
  };
  const tpl = templateFor('booking_confirmation', detail);
  assert.ok(tpl.emailBody.includes('Passengers: 5'));
  assert.ok(tpl.emailBody.includes('$224.99'));
  assert.strictEqual(fields.package_guest_count, 5);
  assert.strictEqual(fields.final_amount_cents, 22499);
}

function runGrouponUnchanged() {
  const skipped = validateDirectBioPackageCheckout({
    charterType: 'bio',
    pricingPackageId: 'bio_four',
    passengerCountFromClient: 5,
    bookingSource: 'groupon',
    fifthPassengerAddonFromClient: true,
  });
  assert.strictEqual(skipped.ok, true);
  assert.strictEqual(skipped.skipPackage, true);
}

function run() {
  runCatalogTests();
  runPricingWithoutAddon();
  runPricingWithAddon();
  runValidationTests();
  runTamperAndResolveTests();
  runCapacityTests();
  runDisplayCopyTests();
  runConfirmationAndWebhookShapeTests();
  runGrouponUnchanged();
  console.log('bioFourFifthPassenger.test.js: all tests passed');
}

run();
