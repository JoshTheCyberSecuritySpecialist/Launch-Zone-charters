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
