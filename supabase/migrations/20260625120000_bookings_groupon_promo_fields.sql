-- Groupon direct-booking promo tracking on confirmed bookings and checkout holds.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS promo_code text,
  ADD COLUMN IF NOT EXISTS discount_amount numeric(10, 2),
  ADD COLUMN IF NOT EXISTS original_total numeric(10, 2),
  ADD COLUMN IF NOT EXISTS final_total numeric(10, 2);

COMMENT ON COLUMN public.bookings.promo_code IS 'Applied Groupon/direct promo code (e.g. GROUPON, GROUPONFUN).';
COMMENT ON COLUMN public.bookings.discount_amount IS 'Promo discount in USD (original_total − final_total).';
COMMENT ON COLUMN public.bookings.original_total IS 'Pre-promo reservation total in USD.';
COMMENT ON COLUMN public.bookings.final_total IS 'Post-promo reservation total in USD (matches total_price when promo applied).';
