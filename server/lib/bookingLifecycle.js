/**
 * Paid booking status and public confirmation summary helpers.
 */

const { DateTime } = require('luxon');
const {
  formatCharterDurationLabel,
  normalizeCharterDurationMinutes,
} = require('./charterDuration');
const { formatReservationNumber } = require('./reservationNumber');
const {
  googleMapsDirectionsUrl,
  locationText,
  resolveMeetingLocation,
} = require('./meetingLocations');

const BUSINESS_TZ = String(process.env.BUSINESS_TIMEZONE || 'America/New_York').trim();

function resolvePaidBookingStatus({
  isCharterBooking,
  waiverAccepted,
  waiverSignature,
  captainIncluded = false,
  licenseStatus = 'pending',
  insuranceStatus = 'pending',
}) {
  const waiverComplete = Boolean(waiverAccepted) && String(waiverSignature || '').trim().length > 0;
  if (isCharterBooking && waiverComplete) {
    return 'confirmed';
  }
  const licenseOk = String(licenseStatus || '').trim().toLowerCase() === 'verified';
  const insuranceOk =
    Boolean(captainIncluded) || String(insuranceStatus || '').trim().toLowerCase() === 'verified';
  if (waiverComplete && licenseOk && insuranceOk) {
    return 'confirmed';
  }
  return 'pending_verification';
}

function formatDateLabel(iso) {
  const dt = DateTime.fromISO(String(iso || ''), { zone: 'utc' }).setZone(BUSINESS_TZ);
  return dt.isValid ? dt.toFormat('EEEE, MMMM d, yyyy') : '—';
}

function formatTimeLabel(iso) {
  const dt = DateTime.fromISO(String(iso || ''), { zone: 'utc' }).setZone(BUSINESS_TZ);
  return dt.isValid ? dt.toFormat('h:mm a') : '—';
}

function formatTimeRange(startIso, endIso) {
  const start = formatTimeLabel(startIso);
  const end = formatTimeLabel(endIso);
  const startDt = DateTime.fromISO(String(startIso || ''), { zone: 'utc' }).setZone(BUSINESS_TZ);
  const endDt = DateTime.fromISO(String(endIso || ''), { zone: 'utc' }).setZone(BUSINESS_TZ);
  if (!startDt.isValid || !endDt.isValid) return `${start} – ${end}`;
  if (!startDt.hasSame(endDt, 'day')) {
    return `${start} – ${end} (${endDt.toFormat('MMM d')})`;
  }
  return `${start} – ${end}`;
}

function durationMinutesFromBooking(booking) {
  const start = Date.parse(String(booking?.start_time || ''));
  const end = Date.parse(String(booking?.end_time || ''));
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
    return normalizeCharterDurationMinutes((end - start) / 60000);
  }
  return normalizeCharterDurationMinutes(60);
}

function amountPaidValue(booking) {
  const n = Number(booking?.deposit_paid ?? booking?.amount_collected ?? booking?.final_total ?? booking?.total_price);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function experienceLabel(booking) {
  if (booking.pricing_package_name) return String(booking.pricing_package_name);
  const charterType = String(booking.charter_type || '').trim().toLowerCase();
  if (charterType === 'bio') return 'Bioluminescence Night Tour';
  if (charterType === 'rocket') return 'Rocket Launch Viewing Charter';
  if (charterType === 'sunset') return 'Sunset Cruise';
  if (charterType === 'captain_charter') return 'Captain-Led Charter';
  if (String(booking.booking_type || '') === 'rental') {
    const rentalType = String(booking.rental_type || '').replace(/_/g, ' ');
    return rentalType ? `${rentalType} rental` : 'Boat rental';
  }
  return 'Launch Zone Charters experience';
}

function buildPublicConfirmationSummary({ booking, customer, boat }) {
  const meeting = resolveMeetingLocation(booking);
  const mapsUrl = meeting?.address1 ? googleMapsDirectionsUrl(meeting) : null;
  const charterType = String(booking.charter_type || '').trim().toLowerCase();
  const charterSeating = String(booking.charter_seating || '').trim().toLowerCase();
  const departureStatus = String(booking.departure_confirmation_status || '').trim();
  const rocketSharedAwaitingMinimum =
    charterType === 'rocket' &&
    charterSeating === 'shared' &&
    departureStatus === 'awaiting_minimum';
  const rocketDepartureConfirmed =
    charterType === 'rocket' &&
    (charterSeating === 'private' ||
      departureStatus === 'departure_confirmed' ||
      departureStatus === 'departure_full');
  return {
    bookingId: booking.id,
    bookingType: booking.booking_type || null,
    charterType: booking.charter_type || null,
    charterSeating: booking.charter_seating || null,
    status: booking.status || null,
    departureConfirmationStatus: booking.departure_confirmation_status || null,
    rocketSharedAwaitingMinimum,
    rocketDepartureConfirmed,
    paymentStatus: booking.payment_status || null,
    waiverSigned: Boolean(booking.waiver_signed),
    confirmationEmailSent: Boolean(booking.booking_confirmation_sent_at),
    customerEmail: customer?.email || null,
    reservationNumber: formatReservationNumber(booking.id),
    dateLabel: formatDateLabel(booking.start_time),
    timeRange: formatTimeRange(booking.start_time, booking.end_time),
    guests: Math.max(1, Number(booking.guest_count || booking.package_guest_count || 1)),
    durationMinutes: durationMinutesFromBooking(booking),
    durationLabel: formatCharterDurationLabel(durationMinutesFromBooking(booking)),
    amountPaid: amountPaidValue(booking),
    experience: experienceLabel(booking),
    boatName: boat?.name || null,
    meeting:
      rocketSharedAwaitingMinimum
        ? null
        : meeting
          ? {
              id: meeting.id,
              name: meeting.name,
              address1: meeting.address1,
              city: meeting.city,
              state: meeting.state,
              postalCode: meeting.postalCode,
              fullAddress: locationText(meeting),
              instructions: meeting.meetingInstructions || null,
              directionsNote: meeting.directionsNote || null,
              mapsUrl,
            }
          : null,
  };
}

module.exports = {
  buildPublicConfirmationSummary,
  resolvePaidBookingStatus,
};
