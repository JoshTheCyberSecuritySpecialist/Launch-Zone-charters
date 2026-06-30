-- Notification tracking for waivers & insurance flow (Phase 3).

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS waivers_docs_confirmation_sent_at timestamptz;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS waivers_docs_reminder_sent_at timestamptz;

ALTER TABLE public.pre_trip_submissions
  ADD COLUMN IF NOT EXISTS customer_notified_at timestamptz;

ALTER TABLE public.pre_trip_submissions
  ADD COLUMN IF NOT EXISTS admin_notified_at timestamptz;

ALTER TABLE public.pre_trip_submissions
  ADD COLUMN IF NOT EXISTS docs_reminder_sent_at timestamptz;

COMMENT ON COLUMN public.bookings.waivers_docs_confirmation_sent_at IS
  'Customer confirmation email after waiver/docs submitted via /waivers-insurance.';
COMMENT ON COLUMN public.bookings.waivers_docs_reminder_sent_at IS
  'One-time reminder when license or insurance still missing before trip.';
