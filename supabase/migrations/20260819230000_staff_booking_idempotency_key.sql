-- Idempotency for admin staff booking creates (safe retries after timeout/double-submit).

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS staff_idempotency_key uuid;

COMMENT ON COLUMN public.bookings.staff_idempotency_key IS
  'Client UUID for POST /api/admin/staff-bookings; unique when present so retries return the same row.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_staff_idempotency_key
  ON public.bookings (staff_idempotency_key)
  WHERE staff_idempotency_key IS NOT NULL;
