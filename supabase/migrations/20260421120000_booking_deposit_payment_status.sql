-- Deposit checkout (Stripe): expected amount + payment lifecycle (deposit_paid updated via webhook).

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS deposit_amount numeric(10,2);

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'pending';

COMMENT ON COLUMN public.bookings.payment_status IS 'pending | deposit_paid | failed (extend as needed)';
COMMENT ON COLUMN public.bookings.deposit_amount IS 'Deposit due in USD for Stripe Checkout (typically 50% of total).';
