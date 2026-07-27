BEGIN;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS groupon_voucher_id uuid REFERENCES public.groupon_vouchers (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_groupon_voucher_id
  ON public.bookings (groupon_voucher_id)
  WHERE groupon_voucher_id IS NOT NULL;

COMMENT ON COLUMN public.bookings.groupon_voucher_id IS
  'Linked imported Groupon voucher when booking was funded by voucher coverage.';

COMMIT;
