-- Enforce idempotency at the database layer for Stripe-linked bookings.
-- Allows multiple NULLs while preventing duplicate non-null Stripe IDs.

CREATE UNIQUE INDEX IF NOT EXISTS bookings_stripe_payment_id_uidx
  ON public.bookings (stripe_payment_id)
  WHERE stripe_payment_id IS NOT NULL;
