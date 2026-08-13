/**
 * Paid booking status and public confirmation summary helpers.
 */

const { DateTime } = require('luxon');
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
  return {
    bookingId: booking.id,
    bookingType: booking.booking_type || null,
    charterType: booking.charter_type || null,
    status: booking.status || null,
    paymentStatus: booking.payment_status || null,
    waiverSigned: Boolean(booking.waiver_signed),
    confirmationEmailSent: Boolean(booking.booking_confirmation_sent_at),
    customerEmail: customer?.email || null,
    dateLabel: formatDateLabel(booking.start_time),
    timeRange: formatTimeRange(booking.start_time, booking.end_time),
    guests: Math.max(1, Number(booking.guest_count || booking.package_guest_count || 1)),
    experience: experienceLabel(booking),
    boatName: boat?.name || null,
    meeting: meeting
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
