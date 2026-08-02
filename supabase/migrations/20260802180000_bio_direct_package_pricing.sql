-- Direct bioluminescence package pricing (Groupon deal parity). Additive; legacy rows stay null.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS pricing_package_id text,
  ADD COLUMN IF NOT EXISTS pricing_package_name text,
  ADD COLUMN IF NOT EXISTS package_guest_count integer,
  ADD COLUMN IF NOT EXISTS standard_value_cents integer,
  ADD COLUMN IF NOT EXISTS package_price_cents integer,
  ADD COLUMN IF NOT EXISTS discount_amount_cents integer,
  ADD COLUMN IF NOT EXISTS final_amount_cents integer;

COMMENT ON COLUMN public.bookings.pricing_package_id IS
  'Direct bio package id (bio_solo, bio_two, bio_four). Null for legacy per-guest bio pricing.';

CREATE INDEX IF NOT EXISTS idx_bookings_pricing_package_id
  ON public.bookings (pricing_package_id)
  WHERE pricing_package_id IS NOT NULL;
