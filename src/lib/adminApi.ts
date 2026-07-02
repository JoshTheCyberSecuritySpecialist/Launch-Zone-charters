import { apiGet, clearApiCache } from './apiClient';

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

export function getAdminAlerts(token: string) {
  return apiGet('/api/admin/alerts', { headers: authHeaders(token) });
}

export function getAdminSubscribers(token: string) {
  return apiGet('/api/admin/subscribers', { headers: authHeaders(token) });
}

export function getPaymentRecoveryQueue(token: string) {
  return apiGet('/api/admin/payment-recovery', {
    headers: authHeaders(token),
    skipCache: true,
  });
}

export function getBookingHealth(token: string) {
  return apiGet('/api/admin/booking-health', {
    headers: authHeaders(token),
    skipCache: true,
  });
}

export function getIncidentsByBookingId(bookingId: string, token: string, options?: { skipCache?: boolean }) {
  if (!bookingId) throw new Error('getIncidentsByBookingId requires a booking id');
  return apiGet(`/api/incidents/${encodeURIComponent(bookingId)}`, {
    headers: authHeaders(token),
    skipCache: options?.skipCache,
  });
}

export function clearIncidentsByBookingIdCache(bookingId: string) {
  if (!bookingId) return;
  clearApiCache(`/api/incidents/${encodeURIComponent(bookingId)}`);
}
