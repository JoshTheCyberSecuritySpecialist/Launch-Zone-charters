-- Rocket shared departure grouping + confirmation state (separate from bookings.status).

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS shared_departure_id uuid,
  ADD COLUMN IF NOT EXISTS departure_confirmation_status text;

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_departure_confirmation_status_check;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_departure_confirmation_status_check
  CHECK (
    departure_confirmation_status IS NULL
    OR departure_confirmation_status IN (
      'awaiting_minimum',
      'departure_confirmed',
      'departure_full'
    )
  );

CREATE INDEX IF NOT EXISTS idx_bookings_shared_departure_id
  ON public.bookings (shared_departure_id)
  WHERE shared_departure_id IS NOT NULL;

COMMENT ON COLUMN public.bookings.shared_departure_id IS
  'Groups shared rocket launch bookings on the same boat + departure time for minimum-guest tracking.';

COMMENT ON COLUMN public.bookings.departure_confirmation_status IS
  'Rocket shared departure confirmation (null = not applicable). Distinct from payment bookings.status.';
