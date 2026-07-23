import { DateTime } from 'luxon';
import { BUSINESS_TZ, bookingFormTimesFromIso } from './bookingDateTimeRange';

const LOCATION_COORDS: Record<string, { lat: number; lon: number; label: string }> = {
  'port orange': { lat: 29.1383, lon: -80.9956, label: 'Port Orange, FL' },
  daytona: { lat: 29.1383, lon: -80.9956, label: 'Daytona Beach, FL' },
  titusville: { lat: 28.6122, lon: -80.8076, label: 'Titusville, FL' },
};

export function resolveLocationCoords(location: string | null | undefined) {
  const key = String(location || '')
    .trim()
    .toLowerCase();
  if (!key) return null;
  if (LOCATION_COORDS[key]) return LOCATION_COORDS[key];
  if (key.includes('port orange') || key.includes('daytona')) return LOCATION_COORDS['port orange'];
  if (key.includes('titusville') || key.includes('canaveral')) return LOCATION_COORDS.titusville;
  return { lat: 29.1383, lon: -80.9956, label: location || 'Launch Zone Charters' };
}

export function formatTripTimeRange(startIso: string, endIso: string) {
  const start = DateTime.fromISO(startIso, { zone: 'utc' }).setZone(BUSINESS_TZ);
  const end = DateTime.fromISO(endIso, { zone: 'utc' }).setZone(BUSINESS_TZ);
  if (!start.isValid || !end.isValid) return { startLabel: '—', endLabel: '—', dayLabel: '—', crossesMidnight: false };

  const crossesMidnight = !start.hasSame(end, 'day');
  const startLabel = start.toFormat('h:mm a');
  const endLabel = crossesMidnight ? `${end.toFormat('h:mm a')} (+1)` : end.toFormat('h:mm a');
  const dayLabel = start.toFormat('EEEE, MMM d');

  return { startLabel, endLabel, dayLabel, crossesMidnight };
}

export function formatTripDayKey(startIso: string) {
  return DateTime.fromISO(startIso, { zone: 'utc' }).setZone(BUSINESS_TZ).toFormat('yyyy-MM-dd');
}

export function formatTripDayHeading(dayKey: string) {
  const dt = DateTime.fromISO(dayKey, { zone: BUSINESS_TZ });
  if (!dt.isValid) return dayKey;
  const today = DateTime.now().setZone(BUSINESS_TZ).startOf('day');
  if (dt.hasSame(today, 'day')) return 'Today';
  if (dt.hasSame(today.plus({ days: 1 }), 'day')) return 'Tomorrow';
  return dt.toFormat('EEEE, MMMM d');
}

export function normalizePhoneForTel(phone: string | null | undefined) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`;
}

export function customerTelHref(phone: string | null | undefined) {
  const normalized = normalizePhoneForTel(phone);
  return normalized ? `tel:${normalized}` : null;
}

export function customerSmsHref(phone: string | null | undefined) {
  const normalized = normalizePhoneForTel(phone);
  return normalized ? `sms:${normalized}` : null;
}

export function directionsLinks(location: string | null | undefined) {
  const coords = resolveLocationCoords(location);
  const query = encodeURIComponent(coords?.label || location || 'Launch Zone Charters Florida');
  const apple = coords
    ? `https://maps.apple.com/?ll=${coords.lat},${coords.lon}&q=${query}`
    : `https://maps.apple.com/?q=${query}`;
  const google = coords
    ? `https://www.google.com/maps/search/?api=1&query=${coords.lat},${coords.lon}`
    : `https://www.google.com/maps/search/?api=1&query=${query}`;
  return { apple, google };
}

export function bookingStatusTone(status: string): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  switch (status) {
    case 'ready_for_departure':
    case 'completed':
      return 'success';
    case 'confirmed':
      return 'info';
    case 'pending_verification':
    case 'pending':
    case 'hold':
      return 'warning';
    case 'cancelled':
      return 'danger';
    default:
      return 'neutral';
  }
}

export function captainProgressTone(progress: string): 'neutral' | 'success' | 'warning' | 'info' {
  switch (progress) {
    case 'completed':
      return 'success';
    case 'in_progress':
      return 'info';
    case 'arrived':
      return 'warning';
    default:
      return 'neutral';
  }
}

export function nextDepartureLabel(bookings: Array<{ start_time: string }>) {
  if (!bookings.length) return 'No trips scheduled';
  const now = DateTime.now().setZone(BUSINESS_TZ);
  const upcoming = [...bookings]
    .map((b) => ({
      start: DateTime.fromISO(b.start_time, { zone: 'utc' }).setZone(BUSINESS_TZ),
    }))
    .filter((row) => row.start.isValid)
    .sort((a, b) => a.start.toMillis() - b.start.toMillis());

  const next = upcoming.find((row) => row.start >= now) || upcoming[0];
  if (!next) return 'No trips scheduled';
  return next.start.toFormat('h:mm a');
}

export function overnightTripNote(startIso: string, endIso: string) {
  const times = bookingFormTimesFromIso(startIso, endIso, BUSINESS_TZ);
  if (!times.crossesMidnight) return null;
  const end = DateTime.fromISO(endIso, { zone: 'utc' }).setZone(BUSINESS_TZ);
  return `Ends ${end.toFormat('cccc h:mm a')}`;
}
