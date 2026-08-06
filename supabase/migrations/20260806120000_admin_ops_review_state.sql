-- Admin operations dashboard: per-admin "new booking" acknowledgement (service role API only).

BEGIN;

CREATE TABLE IF NOT EXISTS public.admin_ops_review_state (
  admin_user_id uuid PRIMARY KEY,
  last_reviewed_at timestamptz NOT NULL DEFAULT '1970-01-01T00:00:00+00'::timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.admin_ops_review_state IS
  'Tracks when each admin last marked all bookings reviewed (ops dashboard).';

CREATE TABLE IF NOT EXISTS public.admin_booking_acknowledgements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL,
  booking_id uuid NOT NULL REFERENCES public.bookings (id) ON DELETE CASCADE,
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (admin_user_id, booking_id)
);

CREATE INDEX IF NOT EXISTS idx_admin_booking_ack_admin_time
  ON public.admin_booking_acknowledgements (admin_user_id, acknowledged_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_booking_ack_booking
  ON public.admin_booking_acknowledgements (booking_id);

COMMENT ON TABLE public.admin_booking_acknowledgements IS
  'Individual booking marked reviewed on the operations dashboard.';

ALTER TABLE public.admin_ops_review_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_booking_acknowledgements ENABLE ROW LEVEL SECURITY;

-- No anon/authenticated policies: Express API uses service role.

COMMIT;
