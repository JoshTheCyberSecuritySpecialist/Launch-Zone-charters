/**
 * Frontend mirror of server/lib/meetingLocations.js.
 * Keep values in sync — customer communications must use the same meeting point.
 */

export type MeetingLocation = {
  id: string;
  name: string;
  address1: string | null;
  city: string;
  state: string;
  postalCode: string | null;
  meetingInstructions?: string | null;
  directionsNote?: string | null;
};

export const TITUSVILLE_MEETING_LOCATION: MeetingLocation = {
  id: 'parrish_park',
  name: 'Parrish Park Boat Ramp',
  address1: '1 A. Max Brewer Memorial Pkwy',
  city: 'Titusville',
  state: 'FL',
  postalCode: '32796',
  meetingInstructions: 'Meet us by the docks/boat ramp where the boats are launched.',
};

export const BIO_DEPARTURE_AREA_LABEL = 'Titusville / Max Brewer Bridge Area';

export function locationText(location: MeetingLocation | null | undefined): string {
  if (!location) return '';
  const parts = [
    location.name,
    location.address1,
    [location.city, location.state, location.postalCode].filter(Boolean).join(', '),
  ].filter(Boolean);
  return parts.join(', ');
}

export function googleMapsDirectionsUrl(location: MeetingLocation | null | undefined): string | null {
  const destination = locationText(location);
  if (!destination) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}
