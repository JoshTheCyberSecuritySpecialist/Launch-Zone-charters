/**
 * Admin customer-support lookup, exception queue, timeline, and alternatives.
 */
const { DateTime } = require('luxon');
const availabilityService = require('./availabilityService');
const boatCapacityService = require('./boatCapacityService');
const { maskVoucherLastFour } = require('./grouponVoucherUtils');
const { releaseVoucherReservation } = require('./grouponVoucherReservationService');

function normalizePhoneDigits(raw) {
  return String(raw || '').replace(/\D/g, '');
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

function bookingSummaryRow(row) {
  const customer = Array.isArray(row.customers) ? row.customers[0] : row.customers;
  const boat = Array.isArray(row.boats) ? row.boats[0] : row.boats;
  const captain = Array.isArray(row.captains) ? row.captains[0] : row.captains;
  return {
    id: row.id,
    customerName: customer?.full_name || 'Unknown',
    email: customer?.email || null,
    phone: customer?.phone || null,
    startTime: row.start_time,
    endTime: row.end_time,
    status: row.status,
    paymentStatus: row.payment_status,
    paymentMethod: row.payment_method,
    bookingSource: row.booking_source,
    bookingType: row.booking_type,
    charterType: row.charter_type,
    guestCount: row.guest_count,
    boatName: boat?.name || null,
    captainName: captain?.full_name || null,
    waiverSigned: Boolean(row.waiver_signed),
    insuranceStatus: row.insurance_status,
    licenseStatus: row.license_status,
    grouponVoucherId: row.groupon_voucher_id || null,
  };
}

async function searchBookings(supabase, { query, lastFour, merchantReferenceId, limit = 25 }) {
  const q = String(query || '').trim();
  const results = [];
  const seen = new Set();

  const pushBooking = (row, matchReason) => {
    if (!row?.id || seen.has(row.id)) return;
    seen.add(row.id);
    results.push({ type: 'booking', matchReason, ...bookingSummaryRow(row) });
  };

  if (isUuid(q)) {
    const { data } = await supabase
      .from('bookings')
      .select('*, customers(full_name, email, phone), boats(name), captains(full_name)')
      .eq('id', q)
      .maybeSingle();
    if (data) pushBooking(data, 'booking_id');
  }

  if (q.length >= 2) {
    const safeQ = q.replace(/[%_,]/g, '');
    const { data: customers } = await supabase
      .from('customers')
      .select('id')
      .or(`full_name.ilike.%${safeQ}%,email.ilike.%${safeQ}%`)
      .limit(20);
    const customerIds = (customers || []).map((c) => c.id).filter(Boolean);
    if (customerIds.length) {
      const { data: byCustomer } = await supabase
        .from('bookings')
        .select('*, customers(full_name, email, phone), boats(name), captains(full_name)')
        .in('customer_id', customerIds)
        .order('start_time', { ascending: false })
        .limit(limit);
      for (const row of byCustomer || []) pushBooking(row, 'customer_name_or_email');
    }
  }

  const digits = normalizePhoneDigits(q);
  if (digits.length >= 7) {
    const { data: customers } = await supabase
      .from('customers')
      .select('id, full_name, email, phone')
      .ilike('phone', `%${digits.slice(-7)}%`)
      .limit(20);
    const customerIds = (customers || []).map((c) => c.id).filter(Boolean);
    if (customerIds.length) {
      const { data: byPhone } = await supabase
        .from('bookings')
        .select('*, customers(full_name, email, phone), boats(name), captains(full_name)')
        .in('customer_id', customerIds)
        .order('start_time', { ascending: false })
        .limit(limit);
      for (const row of byPhone || []) pushBooking(row, 'phone');
    }
  }

  const voucherLastFour = String(lastFour || '').trim().toUpperCase().slice(-4);
  if (voucherLastFour.length === 4) {
    const { data: vouchers } = await supabase
      .from('groupon_vouchers')
      .select('id, voucher_last_four, owner_name, booking_id, merchant_reference_id, local_status, source_status')
      .eq('voucher_last_four', voucherLastFour)
      .limit(20);
    for (const voucher of vouchers || []) {
      if (voucher.booking_id) {
        const { data: booking } = await supabase
          .from('bookings')
          .select('*, customers(full_name, email, phone), boats(name), captains(full_name)')
          .eq('id', voucher.booking_id)
          .maybeSingle();
        if (booking) pushBooking(booking, 'voucher_last_four');
      } else {
        results.push({
          type: 'voucher',
          matchReason: 'voucher_last_four',
          voucherId: voucher.id,
          voucherMasked: maskVoucherLastFour(voucher.voucher_last_four),
          ownerName: voucher.owner_name,
          localStatus: voucher.local_status,
          sourceStatus: voucher.source_status,
          bookingId: null,
        });
      }
    }
  }

  const merchantRef = String(merchantReferenceId || q || '').trim();
  if (merchantRef.length >= 3) {
    const { data: vouchers } = await supabase
      .from('groupon_vouchers')
      .select('id, voucher_last_four, owner_name, booking_id, merchant_reference_id, local_status, source_status')
      .eq('merchant_reference_id', merchantRef)
      .limit(20);
    for (const voucher of vouchers || []) {
      if (voucher.booking_id) {
        const { data: booking } = await supabase
          .from('bookings')
          .select('*, customers(full_name, email, phone), boats(name), captains(full_name)')
          .eq('id', voucher.booking_id)
          .maybeSingle();
        if (booking) pushBooking(booking, 'merchant_reference_id');
      } else {
        results.push({
          type: 'voucher',
          matchReason: 'merchant_reference_id',
          voucherId: voucher.id,
          voucherMasked: maskVoucherLastFour(voucher.voucher_last_four),
          ownerName: voucher.owner_name,
          localStatus: voucher.local_status,
          sourceStatus: voucher.source_status,
          merchantReferenceId: voucher.merchant_reference_id,
          bookingId: null,
        });
      }
    }
  }

  return results.slice(0, limit);
}

async function loadGrouponForBooking(supabase, booking) {
  if (!booking?.groupon_voucher_id && !booking?.id) return null;
  let query = supabase
    .from('groupon_vouchers')
    .select('*, groupon_deal_option_mappings(service_label, covered_guest_count, booking_type, charter_type, rental_type)')
    .limit(1);
  if (booking.groupon_voucher_id) query = query.eq('id', booking.groupon_voucher_id);
  else query = query.eq('booking_id', booking.id);
  const { data, error } = await query.maybeSingle();
  if (error || !data) return null;
  const mapping = Array.isArray(data.groupon_deal_option_mappings)
    ? data.groupon_deal_option_mappings[0]
    : data.groupon_deal_option_mappings;
  return {
    id: data.id,
    voucherMasked: maskVoucherLastFour(data.voucher_last_four),
    ownerName: data.owner_name,
    merchantReferenceId: data.merchant_reference_id,
    sourceStatus: data.source_status,
    localStatus: data.local_status,
    redeemedFlag: data.redeemed_flag,
    dealName: data.deal_name,
    optionName: data.option_name,
    expiresAt: data.expires_at,
    reviewFlags: data.review_flags || [],
    mapping,
  };
}

async function buildConsolidatedSupportView(supabase, bookingId) {
  const { data: booking, error } = await supabase
    .from('bookings')
    .select(
      '*, customers(id, full_name, email, phone, id_document_url, insurance_proof_url), boats(id, name, type), captains(id, full_name, phone, email), waivers(id, electronic_signature, signature_date, accepted), user_verifications(*)'
    )
    .eq('id', bookingId)
    .maybeSingle();
  if (error) throw error;
  if (!booking?.id) return null;

  const [{ data: activity }, { data: communications }, { data: voucherEvents }, groupon, capacity] =
    await Promise.all([
      supabase
        .from('booking_activity_events')
        .select('id, event_type, actor_type, message, payload, created_at')
        .eq('booking_id', bookingId)
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('booking_communications')
        .select('id, channel, message_type, recipient, subject, status, created_at, sent_at')
        .eq('booking_id', bookingId)
        .order('created_at', { ascending: false })
        .limit(100),
      booking.groupon_voucher_id
        ? supabase
            .from('groupon_voucher_events')
            .select('id, event_type, actor_type, message, payload, created_at')
            .eq('voucher_id', booking.groupon_voucher_id)
            .order('created_at', { ascending: false })
            .limit(50)
        : Promise.resolve({ data: [] }),
      loadGrouponForBooking(supabase, booking),
      boatCapacityService.getCapacityDetailForBooking(supabase, bookingId).catch(() => null),
    ]);

  const timeline = [
    ...(activity || []).map((row) => ({
      id: row.id,
      at: row.created_at,
      kind: 'activity',
      title: row.event_type,
      message: row.message,
      actorType: row.actor_type,
    })),
    ...(communications || []).map((row) => ({
      id: row.id,
      at: row.sent_at || row.created_at,
      kind: 'communication',
      title: row.message_type,
      message: `${row.channel}: ${row.subject || row.status}`,
      actorType: 'admin',
    })),
    ...(voucherEvents || []).map((row) => ({
      id: row.id,
      at: row.created_at,
      kind: 'voucher',
      title: row.event_type,
      message: row.message,
      actorType: row.actor_type,
    })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  const customer = Array.isArray(booking.customers) ? booking.customers[0] : booking.customers;
  const boat = Array.isArray(booking.boats) ? booking.boats[0] : booking.boats;
  const captain = Array.isArray(booking.captains) ? booking.captains[0] : booking.captains;

  return {
    booking: {
      ...bookingSummaryRow(booking),
      emergencyContactNotes: booking.emergency_contact_notes,
      adminNotes: booking.admin_notes,
      staffNotes: booking.staff_notes,
      specialRequests: booking.special_requests,
      balanceDue: booking.balance_due,
      totalPrice: booking.total_price,
      depositPaid: booking.deposit_paid,
      startTime: booking.start_time,
      endTime: booking.end_time,
    },
    customer,
    boat,
    captain,
    groupon,
    capacity: capacity
      ? {
          status: capacity.status,
          message: capacity.message,
          totalWeight: capacity.manifest?.total_guest_weight_lbs,
          passengerCount: capacity.manifest?.passenger_count,
        }
      : null,
    waiver: {
      signed: Boolean(booking.waiver_signed),
      insuranceStatus: booking.insurance_status,
      licenseStatus: booking.license_status,
      waiverCount: Array.isArray(booking.waivers) ? booking.waivers.length : booking.waivers ? 1 : 0,
    },
    communications: communications || [],
    timeline,
  };
}

function exceptionFromVoucher(voucher, mapping, reason, detail) {
  return {
    id: `${reason}:${voucher.id}`,
    reason,
    detail,
    voucherId: voucher.id,
    voucherMasked: maskVoucherLastFour(voucher.voucher_last_four),
    ownerName: voucher.owner_name,
    bookingId: voucher.booking_id,
    dealName: voucher.deal_name,
    optionName: voucher.option_name,
    sourceStatus: voucher.source_status,
    localStatus: voucher.local_status,
    serviceLabel: mapping?.service_label || null,
    createdAt: voucher.updated_at || voucher.created_at,
  };
}

async function listGrouponExceptions(supabase, { limit = 100 } = {}) {
  const nowIso = new Date().toISOString();
  const { data: vouchers, error } = await supabase
    .from('groupon_vouchers')
    .select('*, groupon_deal_option_mappings(service_label, covered_guest_count)')
    .order('updated_at', { ascending: false })
    .limit(500);
  if (error) throw error;

  const exceptions = [];
  for (const row of vouchers || []) {
    const mapping = Array.isArray(row.groupon_deal_option_mappings)
      ? row.groupon_deal_option_mappings[0]
      : row.groupon_deal_option_mappings;
    const flags = Array.isArray(row.review_flags) ? row.review_flags : [];

    if (flags.includes('refunded_linked_booking') || (row.refunded_at && row.booking_id)) {
      const { data: linked } = await supabase
        .from('bookings')
        .select('id, start_time, status')
        .eq('id', row.booking_id)
        .maybeSingle();
      if (linked && !['cancelled', 'completed'].includes(String(linked.status)) && new Date(linked.start_time).getTime() > Date.now()) {
        exceptions.push(
          exceptionFromVoucher(row, mapping, 'refunded_linked_booking', 'Refunded voucher linked to a future booking.')
        );
      }
    }
    if (String(row.redeemed_flag || '').toLowerCase() === 'yes' && !row.booking_id) {
      exceptions.push(exceptionFromVoucher(row, mapping, 'redeemed_without_booking', 'Redeemed on import but not linked locally.'));
    }
    if (!row.mapping_id) {
      exceptions.push(exceptionFromVoucher(row, mapping, 'unmapped_option', 'Deal option has no service mapping.'));
    }
    if (flags.includes('source_status_conflict')) {
      exceptions.push(exceptionFromVoucher(row, mapping, 'source_status_conflict', 'Imported status conflicts with local booking state.'));
    }
    if (row.local_status === 'reserved' && row.reserved_until && row.reserved_until < nowIso) {
      exceptions.push(exceptionFromVoucher(row, mapping, 'expired_reservation', 'Temporary voucher reservation expired.'));
    }
    if (row.local_status === 'booked' && row.booking_id && (row.refunded_at || String(row.source_status).toLowerCase() === 'refunded')) {
      exceptions.push(exceptionFromVoucher(row, mapping, 'refund_status_mismatch', 'Local booked voucher shows refunded import status.'));
    }
  }

  return exceptions.slice(0, limit);
}

async function listNightlyOperations(supabase, dateYmd) {
  const tz = availabilityService.BUSINESS_TZ;
  const day = dateYmd
    ? DateTime.fromISO(String(dateYmd), { zone: tz }).startOf('day')
    : DateTime.now().setZone(tz).startOf('day');
  const dayEnd = day.plus({ days: 1 });

  const { data, error } = await supabase
    .from('bookings')
    .select(
      'id, start_time, end_time, status, booking_source, payment_method, payment_status, guest_count, waiver_signed, insurance_status, emergency_contact_notes, booking_type, charter_type, groupon_voucher_id, customers(full_name, phone), boats(name), captains(full_name), groupon_vouchers(voucher_last_four, deal_name, option_name, local_status, source_status)'
    )
    .gte('start_time', day.toUTC().toISO())
    .lt('start_time', dayEnd.toUTC().toISO())
    .neq('status', 'cancelled')
    .order('start_time', { ascending: true });
  if (error) throw error;

  const rows = [];
  for (const booking of data || []) {
    const customer = Array.isArray(booking.customers) ? booking.customers[0] : booking.customers;
    const boat = Array.isArray(booking.boats) ? booking.boats[0] : booking.boats;
    const captain = Array.isArray(booking.captains) ? booking.captains[0] : booking.captains;
    const voucher = Array.isArray(booking.groupon_vouchers)
      ? booking.groupon_vouchers[0]
      : booking.groupon_vouchers;
    let totalWeight = null;
    try {
      const cap = await boatCapacityService.getCapacityDetailForBooking(supabase, booking.id);
      totalWeight = cap?.manifest?.total_guest_weight_lbs ?? null;
    } catch {
      totalWeight = null;
    }
    rows.push({
      id: booking.id,
      departureTime: booking.start_time,
      customerName: customer?.full_name || 'Unknown',
      phone: customer?.phone || null,
      guestCount: booking.guest_count,
      totalWeight,
      waiverSigned: Boolean(booking.waiver_signed),
      emergencyContact: booking.emergency_contact_notes || null,
      captainName: captain?.full_name || 'Unassigned',
      boatName: boat?.name || 'Unassigned',
      bookingSource: booking.booking_source || 'website',
      paymentMethod: booking.payment_method,
      arrivalStatus: booking.status,
      completionStatus: booking.status === 'completed' ? 'completed' : 'pending',
      groupon: voucher
        ? {
            voucherMasked: maskVoucherLastFour(voucher.voucher_last_four),
            dealName: voucher.deal_name,
            optionName: voucher.option_name,
          }
        : null,
    });
  }
  return { date: day.toISODate(), departures: rows };
}

async function listBookingAlternatives(supabase, bookingId, { limit = 6 } = {}) {
  const { data: booking, error } = await supabase
    .from('bookings')
    .select('id, boat_id, booking_type, charter_type, rental_location, start_time, end_time, guest_count, groupon_voucher_id')
    .eq('id', bookingId)
    .maybeSingle();
  if (error) throw error;
  if (!booking?.id) return [];

  const start = DateTime.fromISO(String(booking.start_time), { zone: 'utc' }).setZone(availabilityService.BUSINESS_TZ);
  const datesToCheck = [0, 1, 2, 3, 4, 5, 6].map((offset) => start.plus({ days: offset }).toISODate());
  const alternatives = [];
  const isCharter = booking.booking_type === 'charter';
  const charterType = booking.charter_type || 'bio';

  let grouponMapping = null;
  if (booking.groupon_voucher_id) {
    const { data: voucher } = await supabase
      .from('groupon_vouchers')
      .select('groupon_deal_option_mappings(booking_type, charter_type, rental_type, covered_guest_count, service_label)')
      .eq('id', booking.groupon_voucher_id)
      .maybeSingle();
    grouponMapping = Array.isArray(voucher?.groupon_deal_option_mappings)
      ? voucher.groupon_deal_option_mappings[0]
      : voucher?.groupon_deal_option_mappings;
  }

  for (const date of datesToCheck) {
    if (alternatives.length >= limit) break;
    if (isCharter) {
      const slots = await availabilityService.listCharterSlotsForDay(date, charterType);
      for (const slot of slots || []) {
        if (!slot.available) continue;
        if (String(slot.startIso) === String(booking.start_time)) continue;
        alternatives.push({
          startIso: slot.startIso || slot.start,
          label: slot.label,
          date,
          available: true,
          bookingType: 'charter',
          charterType,
          grouponCompatible: grouponMapping ? String(grouponMapping.charter_type) === String(charterType) : true,
          capacityNote: `Up to ${booking.guest_count || 1} guests requested`,
        });
        if (alternatives.length >= limit) break;
      }
    } else if (booking.boat_id || booking.rental_location || booking.groupon_voucher_id) {
      const durationHours = Math.max(1, Math.round((new Date(booking.end_time) - new Date(booking.start_time)) / 3600000));
      const location = booking.rental_location || 'port-orange';
      const rentalSlots = await availabilityService.listRentalSlotsForLocation(
        location,
        date,
        durationHours
      );
      for (const slot of rentalSlots.slots || []) {
        if (!slot.available) continue;
        if (String(slot.startIso) === String(booking.start_time)) continue;
        alternatives.push({
          startIso: slot.startIso,
          label: slot.label,
          date,
          available: true,
          bookingType: 'rental',
          boatId: rentalSlots.boatId,
          grouponCompatible: grouponMapping ? String(grouponMapping.rental_type || '') !== '' : true,
          capacityNote: rentalSlots.boatId ? `Boat ${rentalSlots.boatId}` : location,
        });
        if (alternatives.length >= limit) break;
      }
    }
  }

  return alternatives;
}

async function adminReleaseVoucherReservation(supabase, { voucherId, adminUserId, reason }) {
  const { data: voucher, error } = await supabase
    .from('groupon_vouchers')
    .select('id, reserved_session_token, local_status, booking_id')
    .eq('id', voucherId)
    .maybeSingle();
  if (error) throw error;
  if (!voucher?.id) {
    const err = new Error('Voucher not found.');
    err.statusCode = 404;
    throw err;
  }
  if (voucher.local_status !== 'reserved' || !voucher.reserved_session_token) {
    const err = new Error('This voucher does not have an active temporary reservation.');
    err.statusCode = 409;
    throw err;
  }
  const released = await releaseVoucherReservation(supabase, {
    voucherId: voucher.id,
    sessionToken: voucher.reserved_session_token,
    actorType: 'admin',
    actorId: adminUserId,
    reason: reason || 'Admin released temporary voucher reservation.',
  });
  return { released };
}

module.exports = {
  searchSupportRecords: searchBookings,
  buildConsolidatedSupportView,
  listGrouponExceptions,
  listNightlyOperations,
  listBookingAlternatives,
  adminReleaseVoucherReservation,
};
