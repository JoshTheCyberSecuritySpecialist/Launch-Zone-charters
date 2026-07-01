ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS booking_type text DEFAULT 'rental',
  ADD COLUMN IF NOT EXISTS charter_type text,
  ADD COLUMN IF NOT EXISTS guest_count integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS total_amount numeric(10, 2);

UPDATE public.bookings
SET
  booking_type = COALESCE(booking_type, 'rental'),
  guest_count = COALESCE(guest_count, 1),
  total_amount = COALESCE(total_amount, total_price);

ALTER TABLE public.bookings
  ALTER COLUMN booking_type SET DEFAULT 'rental',
  ALTER COLUMN guest_count SET DEFAULT 1;

COMMENT ON COLUMN public.bookings.booking_type IS 'Booking flow type: rental or charter.';
COMMENT ON COLUMN public.bookings.charter_type IS 'Charter experience type such as bio, rocket, or sunset.';
COMMENT ON COLUMN public.bookings.guest_count IS 'Number of charter guests/tickets.';
COMMENT ON COLUMN public.bookings.total_amount IS 'Authoritative total amount for reporting; mirrors total_price for checkout bookings.';
