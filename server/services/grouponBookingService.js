/**
 * Create Groupon booking requests (pending admin review; no Stripe checkout).
 */
const { DateTime } = require('luxon');
const availabilityService = require('./availabilityService');
const boatCapacityService = require('./boatCapacityService');
const waiverContent = require('../content/waiverContent');
const damageFeeAcknowledgment = require('../lib/damageFeeAcknowledgment');
const bookingReliability = require('./bookingReliability');
const {
  loadReservedVoucherByClientToken,
  linkVoucherToPendingBooking,
  releaseVoucherReservation,
} = require('./grouponVoucherReservationService');
const { sendGrouponRequestReceivedNotifications } = require('./grouponRequestNotifications');
const { evaluateGrouponVoucherEligibility } = require('./grouponVoucherEligibilityService');

const BIO_SHARED_PER_PERSON = 150;
const ROCKET_SHARED_PER_PERSON = 85;
const SUNSET_SHARED_PER_PERSON = 75;

function roundMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function charterTicketPrice(charterType) {
  if (charterType === 'bio') return BIO_SHARED_PER_PERSON;
  if (charterType === 'rocket') return ROCKET_SHARED_PER_PERSON;
  return SUNSET_SHARED_PER_PERSON;
}

async function resolveRentalBoatId(supabase, mapping) {
  const location = mapping?.rental_location || 'port-orange';
  const boatId = await availabilityService.resolveRentalBoatForLocation(location);
  if (!boatId) {
    const err = new Error('Could not assign a boat for this Groupon rental.');
    err.statusCode = 503;
    throw err;
  }
  return boatId;
}

async function computeServiceTotals(supabase, mapping, boatRow = null) {
  const guests = Math.max(1, Number(mapping.covered_guest_count || 1));
  if (mapping.booking_type === 'charter') {
    const ticketPrice = charterTicketPrice(mapping.charter_type);
    const total = roundMoney(guests * ticketPrice);
    return {
      totalPrice: total,
      basePrice: total,
      guestCount: guests,
      durationHours: 1,
      amountDueToday: 0,
    };
  }

  const durationHours = mapping.rental_type === 'full_day' ? 8 : 4;
  const hourly = Number(boatRow?.hourly_rate || 0);
  const halfDay = Number(boatRow?.half_day_rate || 0);
  const fullDay = Number(boatRow?.full_day_rate || 0);
  let basePrice = 0;
  if (mapping.rental_type === 'full_day') basePrice = fullDay;
  else if (mapping.rental_type === 'half_day') basePrice = halfDay;
  else basePrice = hourly * durationHours;
  const total = roundMoney(basePrice);
  return {
    totalPrice: total,
    basePrice: total,
    guestCount: guests,
    durationHours,
    amountDueToday: 0,
  };
}

async function createGrouponBooking(supabase, deps, input) {
  const {
    clientToken,
    customer,
    booking,
    waiver,
    legal,
    requestIp = null,
    sendConfirmation,
    notifyRequest,
  } = input;

  const session = await loadReservedVoucherByClientToken(supabase, clientToken);
  if (!session.ok) {
    const err = new Error(session.customerMessage || 'This booking session expired. Verify your voucher again.');
    err.statusCode = 400;
    err.reasonCode = session.reason;
    throw err;
  }

  const { voucher, mapping, sessionToken, eligibility } = session;
  const coveredGuestCount = eligibility.coveredGuestCount;

  const termsAccepted = Boolean(legal?.termsAccepted);
  const damageFeeAcknowledged = Boolean(legal?.damageFeeAcknowledged);
  const waiverAccepted = Boolean(waiver?.accepted);
  const waiverSignature = String(waiver?.signature || '').trim();
  const signaturePresent = Boolean(legal?.signaturePresent ?? waiverSignature.length > 0);
  if (!termsAccepted || !waiverAccepted || !waiverSignature || !signaturePresent) {
    const err = new Error('Terms, waiver, and signature are required to complete your booking.');
    err.statusCode = 400;
    throw err;
  }
  if (
    damageFeeAcknowledgment.damageFeeAcknowledgmentMissing({
      damageFeeAcknowledged,
      bookingType: mapping.booking_type,
    })
  ) {
    const err = new Error('Terms, waiver, and signature are required to complete your booking.');
    err.statusCode = 400;
    throw err;
  }

  if (!customer?.full_name || !customer?.email || !customer?.phone) {
    const err = new Error('Name, email, and phone are required.');
    err.statusCode = 400;
    throw err;
  }

  const startTime = new Date(String(booking?.start_time || ''));
  if (!Number.isFinite(startTime.getTime())) {
    const err = new Error('Choose a valid departure time.');
    err.statusCode = 400;
    throw err;
  }

  const isCharter = mapping.booking_type === 'charter';
  const durationHours = isCharter ? 1 : mapping.rental_type === 'full_day' ? 8 : 4;
  const endTime = booking?.end_time
    ? new Date(String(booking.end_time))
    : new Date(startTime.getTime() + durationHours * 60 * 60 * 1000);
  if (!Number.isFinite(endTime.getTime()) || endTime.getTime() <= startTime.getTime()) {
    const err = new Error('Invalid booking time range.');
    err.statusCode = 400;
    throw err;
  }

  let boatRow = null;
  let boatId = null;
  if (!isCharter) {
    boatId = await resolveRentalBoatId(supabase, mapping);
    const { data, error } = await supabase
      .from('boats')
      .select('id, name, hourly_rate, half_day_rate, full_day_rate, type')
      .eq('id', boatId)
      .maybeSingle();
    if (error || !data) {
      const err = new Error('Boat not found for this Groupon rental.');
      err.statusCode = 400;
      throw err;
    }
    boatRow = data;
  }

  const totals = await computeServiceTotals(supabase, mapping, boatRow);
  const reCheck = evaluateGrouponVoucherEligibility(voucher, mapping, {
    sessionToken,
    allowReservedSession: sessionToken,
    requestedGuestCount: coveredGuestCount,
    request: {
      bookingType: mapping.booking_type,
      charterType: mapping.charter_type,
      rentalType: mapping.rental_type,
    },
  });
  if (!reCheck.eligible) {
    const err = new Error(reCheck.customerMessage || 'This voucher is no longer available for online booking.');
    err.statusCode = 409;
    throw err;
  }

  let charterInsertFields = null;
  if (isCharter) {
    charterInsertFields = await availabilityService.prepareCharterBookingInsertFields({
      charterType: mapping.charter_type,
      charterVariant: 'shared',
    });
  }

  try {
    if (isCharter) {
      if (!availabilityService.isStartTimeAllowed(startTime.toISOString())) {
        const err = new Error('This departure is too soon. Please choose a later time or call us for help.');
        err.statusCode = 409;
        throw err;
      }
      await availabilityService.assertUnifiedCharterSlotAvailable({
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        charterType: mapping.charter_type,
        charterVariant: 'shared',
        passengerCount: coveredGuestCount,
        bookingSource: 'groupon',
      });
    } else {
      if (!availabilityService.isStartTimeAllowed(startTime.toISOString())) {
        const err = new Error('This departure is too soon. Please choose a later time or call us for help.');
        err.statusCode = 409;
        throw err;
      }
      await availabilityService.assertBookingSlotAvailable({
        boatId,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        location: mapping.rental_location || 'port-orange',
      });
    }
  } catch (slotErr) {
    const err = new Error(slotErr.message || 'That departure time is no longer available.');
    err.statusCode = slotErr.statusCode || 409;
    throw err;
  }

  const { data: customerRow, error: customerError } = await supabase
    .from('customers')
    .upsert(
      {
        full_name: String(customer.full_name),
        email: String(customer.email).trim().toLowerCase(),
        phone: String(customer.phone),
        sms_opt_in: Boolean(customer.sms_opt_in),
      },
      { onConflict: 'email' }
    )
    .select('id, email')
    .single();
  if (customerError || !customerRow) {
    const err = new Error(customerError?.message || 'Could not save customer.');
    err.statusCode = 500;
    throw err;
  }

  const legalAcceptedAt = new Date().toISOString();
  const grouponValue =
    voucher.sell_price_cents != null ? roundMoney(Number(voucher.sell_price_cents) / 100) : totals.totalPrice;

  const bookingInsert = {
    customer_id: customerRow.id,
    boat_id: isCharter ? charterInsertFields?.boat_id || null : boatId,
    booking_type: isCharter ? 'charter' : 'rental',
    charter_type: isCharter ? mapping.charter_type : null,
    charter_seating: isCharter ? charterInsertFields?.charter_seating || null : null,
    guest_count: coveredGuestCount,
    total_amount: totals.totalPrice,
    start_time: startTime.toISOString(),
    end_time: endTime.toISOString(),
    duration_hours: durationHours,
    rental_type: isCharter ? null : mapping.rental_type,
    rental_location: isCharter ? null : mapping.rental_location || 'port-orange',
    captain_included: false,
    captain_fee: 0,
    base_price: totals.basePrice,
    peak_surcharge: 0,
    security_deposit: 0,
    total_price: totals.totalPrice,
    deposit_amount: 0,
    deposit_paid: 0,
    balance_due: 0,
    amount_collected: 0,
    payment_status: 'paid',
    payment_method: 'groupon',
    booking_source: 'groupon',
    status: 'pending_verification',
    is_night_tour: isCharter && mapping.charter_type === 'bio',
    is_rocket_tour: isCharter && mapping.charter_type === 'rocket',
    license_status: isCharter ? 'verified' : 'pending',
    insurance_status: isCharter ? 'verified' : 'pending',
    waiver_signed: true,
    waiver_signed_at: legalAcceptedAt,
    terms_accepted: true,
    damage_fee_acknowledged: damageFeeAcknowledgment.storedDamageFeeAcknowledged({
      damageFeeAcknowledged,
      bookingType: mapping.booking_type,
    }),
    admin_notes: [
      'Booking source: Groupon voucher',
      `Groupon deal: ${voucher.deal_name || '—'}`,
      `Groupon option: ${voucher.option_name || '—'}`,
      `Voucher last four: ${voucher.voucher_last_four}`,
      `Imported status: ${voucher.source_status || '—'}`,
    ].join('\n'),
    original_total: totals.totalPrice,
    final_total: 0,
    discount_amount: totals.totalPrice,
    groupon_voucher_id: voucher.id,
    special_requests: booking?.special_requests ? String(booking.special_requests).trim() : null,
  };

  const { data: bookingRow, error: bookingError } = await supabase
    .from('bookings')
    .insert(bookingInsert)
    .select('id')
    .single();

  if (bookingError || !bookingRow) {
    const sharedMsg = String(bookingError?.message || '').match(/shared_charter_capacity_exceeded:(\d+)/i);
    const err = new Error(
      sharedMsg
        ? `This charter only has ${sharedMsg[1]} passenger spot(s) remaining for the selected time.`
        : bookingError?.message || 'Could not create booking.'
    );
    err.statusCode = bookingError?.code === '23P01' || sharedMsg ? 409 : 500;
    if (err.statusCode === 409 && !sharedMsg) err.message = 'That departure time is no longer available.';
    throw err;
  }

  const linked = await linkVoucherToPendingBooking(supabase, {
    voucherId: voucher.id,
    sessionToken,
    bookingId: bookingRow.id,
    actorType: 'system',
  });
  if (!linked) {
    await supabase.from('bookings').delete().eq('id', bookingRow.id);
    const err = new Error('Could not link voucher to this request. Please try again.');
    err.statusCode = 409;
    throw err;
  }

  const waiverFields = waiverContent.waiverInsertFields(isCharter ? 'charter' : 'rental');
  const { error: waiverErr } = await supabase.from('waivers').insert({
    booking_id: bookingRow.id,
    customer_id: customerRow.id,
    electronic_signature: waiverSignature,
    signature_date: legalAcceptedAt,
    ip_address: requestIp,
    accepted: true,
    ...waiverFields,
  });
  if (waiverErr) {
    console.warn('[groupon-booking] waiver insert:', waiverErr.message);
  }

  await bookingReliability.insertActivity(supabase, {
    booking_id: bookingRow.id,
    event_type: 'groupon_request_submitted',
    actor_type: 'customer',
    message: 'Groupon booking request submitted — awaiting admin approval.',
    payload: {
      grouponVoucherId: voucher.id,
      voucherLastFour: voucher.voucher_last_four,
      grouponValue,
      amountDueToday: 0,
      status: 'pending_verification',
    },
  });

  const notifyFn = typeof notifyRequest === 'function' ? notifyRequest : null;
  if (notifyFn) {
    try {
      await notifyFn({
        bookingId: bookingRow.id,
        customerName: String(customer.full_name),
        guestCount: coveredGuestCount,
        startTime: startTime.toISOString(),
      });
    } catch (notifyErr) {
      console.error('[groupon-booking] request notification:', notifyErr?.message || notifyErr);
    }
  } else if (typeof sendConfirmation === 'function') {
    console.warn('[groupon-booking] sendConfirmation is deprecated for Groupon submit; use notifyRequest.');
  }

  return {
    bookingId: bookingRow.id,
    email: customerRow.email,
    amountDueToday: 0,
    paymentMethod: 'groupon',
    bookingSource: 'groupon',
    status: 'pending_verification',
    voucherMasked: eligibility.voucherMasked,
    coveredGuestCount,
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
  };
}

async function createGrouponBookingSafe(supabase, deps, input) {
  let bookingCreated = false;
  try {
    const result = await createGrouponBooking(supabase, deps, input);
    bookingCreated = true;
    return result;
  } catch (err) {
    if (!bookingCreated && input?.clientToken && err.statusCode !== 400) {
      try {
        const session = await loadReservedVoucherByClientToken(supabase, input.clientToken);
        if (session.ok) {
          await releaseVoucherReservation(supabase, {
            voucherId: session.voucher.id,
            sessionToken: session.sessionToken,
            reason: 'Reservation released after failed booking attempt.',
          });
        }
      } catch (releaseErr) {
        console.warn('[groupon-booking] release after failure:', releaseErr.message);
      }
    }
    throw err;
  }
}

module.exports = {
  createGrouponBooking,
  createGrouponBookingSafe,
  computeServiceTotals,
};
