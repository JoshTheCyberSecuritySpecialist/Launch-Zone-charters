ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS waiver_signed boolean DEFAULT false;
