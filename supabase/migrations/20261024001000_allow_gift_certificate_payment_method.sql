BEGIN;

-- Allow prepaid bioluminescence gift redemptions to record payment_method = gift_certificate.
-- Preserves NULL (legacy rows) and all previously allowed methods.
-- Do NOT apply to production until explicitly approved.

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_payment_method_check;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_payment_method_check CHECK (
    payment_method IS NULL
    OR payment_method IN (
      'stripe',
      'cash',
      'venmo',
      'zelle',
      'paypal',
      'groupon',
      'comp',
      'other',
      'gift_certificate'
    )
  );

COMMENT ON CONSTRAINT bookings_payment_method_check ON public.bookings IS
  'Allowed booking payment methods; gift_certificate = prepaid gift ticket redemption (no new charge).';

COMMIT;
