-- Projects created outside full migration history may lack this column; PostgREST then errors on insert.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS special_requests text;
