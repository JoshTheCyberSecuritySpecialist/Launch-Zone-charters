export type PreTripSubmissionRow = {
  id: string;
  matched_booking_id: string | null;
  customer_name: string | null;
  email: string;
  phone: string | null;
  trip_type: string;
  selected_boat_reg_no: string | null;
  groupon_code: string | null;
  requested_trip_date: string | null;
  waiver_signed: boolean;
  waiver_signed_at: string | null;
  waiver_signature: string | null;
  license_url: string | null;
  insurance_url: string | null;
  license_status: string;
  insurance_status: string;
  admin_status: string;
  admin_notes: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  rejection_reason: string | null;
  created_at: string;
};

export type PreTripListFilter = 'all' | 'review';

export function isPreTripTerminal(status: string): boolean {
  return status === 'approved' || status === 'rejected';
}

export function preTripNeedsReview(status: string): boolean {
  return status === 'pending' || status === 'matched';
}

export function formatReviewedAt(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleString();
}

export function tripTypeLabel(tripType: string): string {
  switch (tripType) {
    case 'pontoon_rental':
      return 'Pontoon Rental';
    case 'center_console_rental':
      return 'Center Console Rental';
    case 'captain_charter':
      return 'Captain-Led Charter';
    default:
      return tripType;
  }
}

export function preTripStatusTone(
  status: string
): 'success' | 'danger' | 'warning' | 'neutral' {
  if (status === 'approved') return 'success';
  if (status === 'rejected') return 'danger';
  if (status === 'pending' || status === 'matched') return 'warning';
  return 'neutral';
}

export function filterPreTripSubmissions(
  rows: PreTripSubmissionRow[],
  filter: PreTripListFilter
): PreTripSubmissionRow[] {
  if (filter === 'review') {
    return rows.filter((row) => preTripNeedsReview(row.admin_status));
  }
  return rows;
}

/** Staff booking form URL pre-filled from a pre-trip / waiver submission. */
export function staffBookingUrlFromPreTripSubmission(row: PreTripSubmissionRow): string {
  const params = new URLSearchParams();
  if (row.customer_name?.trim()) params.set('customerName', row.customer_name.trim());
  if (row.email?.trim()) params.set('email', row.email.trim());
  if (row.phone?.trim()) params.set('phone', row.phone.trim());
  if (row.requested_trip_date) {
    const d = new Date(row.requested_trip_date);
    if (Number.isFinite(d.getTime())) {
      params.set('date', d.toISOString().slice(0, 10));
      if (row.requested_trip_date.includes('T')) {
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        params.set('startTime', `${hh}:${mm}`);
      }
    }
  }
  params.set('bookingType', row.trip_type === 'captain_charter' ? 'captain_charter' : 'rental');
  if (row.groupon_code?.trim()) {
    params.set('bookingSource', 'groupon');
    params.set('paymentMethod', 'groupon');
  }
  params.set('preTripSubmissionId', row.id);
  return `/admin/staff-booking?${params.toString()}`;
}

export function resolvePreTripSelectedBookingId(
  selectedId: string | null | undefined,
  matchedBookingId: string | null | undefined,
  suggestions: { id: string }[] | undefined
): string | null {
  if (selectedId?.trim()) return selectedId.trim();
  if (matchedBookingId?.trim()) return matchedBookingId.trim();
  if (suggestions?.length === 1) return suggestions[0].id;
  return null;
}
