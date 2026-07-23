export type CaptainScheduleView = 'today' | 'week' | 'month' | 'agenda';

export type CaptainProgressAction = 'arrived' | 'start' | 'complete';

export type CaptainVerificationSummary = {
  ready_count: number;
  missing_count: number;
  payment_display: 'Ready' | 'Action Required';
};

export type CaptainListBooking = {
  id: string;
  start_time: string;
  end_time: string;
  status: string;
  captain_progress: string;
  guest_count: number;
  rental_location: string | null;
  charter_type: string;
  customer_name: string;
  customer_phone: string | null;
  boat_name: string;
  boat_id: string | null;
  verification_summary: CaptainVerificationSummary;
  has_notes: boolean;
};

export type CaptainBookingsResponse = {
  view: string;
  from: string;
  to: string;
  bookings: CaptainListBooking[];
};

export type CaptainVerificationItem = {
  key: string;
  label: string;
  done: boolean;
  note?: string;
};

export type CaptainBookingDetail = {
  id: string;
  start_time: string;
  end_time: string;
  status: string;
  captain_progress: string;
  guest_count: number;
  rental_location: string | null;
  charter_type: string;
  customer: {
    full_name: string;
    phone: string | null;
    email: string | null;
  };
  boat: { id: string; name: string; type: string | null } | null;
  captain: { id: string; full_name: string } | null;
  trip_notes: {
    special_requests: string | null;
    staff_notes: string | null;
  };
  emergency_contact_notes: string | null;
  waiver_status: string;
  license_status: string;
  insurance_status: string;
  payment_display: 'Ready' | 'Action Required';
  verification_summary: {
    items: CaptainVerificationItem[];
    ready_count: number;
    missing_count: number;
    payment_display: 'Ready' | 'Action Required';
  };
  capacity_status: string | null;
  passengers: Array<{
    passenger_number: number;
    passenger_name: string;
    passenger_type: string;
    mobility_assistance_required: boolean;
    mobility_notes: string | null;
  }>;
};

export type CaptainBookingDetailResponse = {
  booking: CaptainBookingDetail;
};

export type CaptainProgressResponse = {
  ok: boolean;
  booking_id: string;
  previous_progress: string;
  captain_progress: string;
};

const SCHEDULE_VIEW_KEY = 'lz_captain_schedule_view';

export function readCaptainScheduleView(): CaptainScheduleView {
  try {
    const raw = window.localStorage.getItem(SCHEDULE_VIEW_KEY);
    if (raw === 'today' || raw === 'week' || raw === 'month' || raw === 'agenda') return raw;
  } catch {
    /* ignore */
  }
  return 'agenda';
}

export function writeCaptainScheduleView(view: CaptainScheduleView) {
  try {
    window.localStorage.setItem(SCHEDULE_VIEW_KEY, view);
  } catch {
    /* ignore */
  }
}
