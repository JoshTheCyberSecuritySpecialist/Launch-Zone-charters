-- Double-booking prevention: exclusion constraint + hold metadata.
-- Run after migrations apply; requires btree_gist for UUID + tstzrange exclusion.

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text;

COMMENT ON COLUMN public.bookings.expires_at IS
  'When set with status=pending and no payment id, checkout hold expires at this time (typically now + 10 minutes).';

COMMENT ON COLUMN public.bookings.stripe_checkout_session_id IS
  'Stripe Checkout Session id (cs_...) while the booking is an unpaid hold; cleared after finalize.';

-- One active hold per Checkout Session
CREATE UNIQUE INDEX IF NOT EXISTS bookings_stripe_checkout_session_uidx
  ON public.bookings (stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;

-- No overlapping time ranges for the same boat among active bookings.
-- Cancelled rows are omitted; expired pending holds must be deleted by the cleanup job.
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_boat_no_time_overlap;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_boat_no_time_overlap
  EXCLUDE USING gist (
    boat_id WITH =,
    tstzrange(start_time, end_time, '[)') WITH &&
  )
  WHERE (
    status IN ('pending', 'pending_verification', 'confirmed', 'completed')
  );
