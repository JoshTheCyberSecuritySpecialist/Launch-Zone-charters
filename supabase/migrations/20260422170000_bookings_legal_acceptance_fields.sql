BEGIN;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS waiver_signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS terms_accepted boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS damage_fee_acknowledged boolean DEFAULT false;

COMMIT;

