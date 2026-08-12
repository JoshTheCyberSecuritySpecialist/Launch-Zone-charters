/**
 * Authoritative meeting / departure locations for customer communications.
 */

const TITUSVILLE_MEETING_LOCATION = {
  id: 'parrish_park',
  name: 'Parrish Park Boat Ramp',
  address1: '1 A. Max Brewer Memorial Pkwy',
  city: 'Titusville',
  state: 'FL',
  postalCode: '32796',
};

const PORT_ORANGE_MEETING_LOCATION = {
  id: 'port_orange',
  name: 'Launch Zone Charters — Port Orange / Daytona Beach',
  address1: null,
  city: 'Port Orange',
  state: 'FL',
  postalCode: null,
  directionsNote:
    'Exact ramp details for your rental will be provided before departure. Call 803-542-1761 if you need directions.',
};

function normalizeLocationKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function locationText(location) {
  if (!location) return '';
  const parts = [
    location.name,
    location.address1,
    [location.city, location.state, location.postalCode].filter(Boolean).join(', '),
  ].filter(Boolean);
  return parts.join(', ');
}

function googleMapsDirectionsUrl(location) {
  const destination = locationText(location);
  if (!destination) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}

function isTitusvilleArea(booking) {
  const rentalLocation = normalizeLocationKey(booking?.rental_location);
  if (!rentalLocation) return false;
  return (
    rentalLocation.includes('titusville') ||
    rentalLocation.includes('canaveral') ||
    rentalLocation.includes('max brewer') ||
    rentalLocation.includes('parrish')
  );
}

function isBioOrNightCharter(booking) {
  const charterType = normalizeLocationKey(booking?.charter_type);
  return charterType === 'bio' || Boolean(booking?.is_night_tour);
}

function isTitusvilleCharterProduct(booking) {
  const charterType = normalizeLocationKey(booking?.charter_type);
  return charterType === 'bio' || charterType === 'rocket' || Boolean(booking?.is_night_tour);
}

/**
 * Resolve the customer-facing meeting point for a booking.
 * Parrish Park is used for Titusville / bioluminescence captain-led charters only.
 */
function resolveMeetingLocation(booking) {
  if (!booking) return null;

  const bookingType = normalizeLocationKey(booking.booking_type);
  if (bookingType === 'charter') {
    if (isBioOrNightCharter(booking) || isTitusvilleCharterProduct(booking) || isTitusvilleArea(booking)) {
      return { ...TITUSVILLE_MEETING_LOCATION };
    }
    if (isTitusvilleArea(booking)) {
      return { ...TITUSVILLE_MEETING_LOCATION };
    }
    return { ...PORT_ORANGE_MEETING_LOCATION };
  }

  if (isTitusvilleArea(booking)) {
    return { ...TITUSVILLE_MEETING_LOCATION };
  }

  return { ...PORT_ORANGE_MEETING_LOCATION };
}

module.exports = {
  TITUSVILLE_MEETING_LOCATION,
  PORT_ORANGE_MEETING_LOCATION,
  googleMapsDirectionsUrl,
  locationText,
  resolveMeetingLocation,
};
