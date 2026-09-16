-- Manual "Ready for Departure" override for the admin Trip Readiness review.
--   NULL  -> no override; readiness is auto-computed from deposit/waiver/documents
--   true  -> staff has manually cleared the booking as ready (forces ready)
--   false -> staff has manually held the booking (forces NOT ready)
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS ready_for_departure_override boolean;

COMMENT ON COLUMN public.bookings.ready_for_departure_override IS
  'Admin Trip Readiness override. NULL = auto-compute; true = force ready; false = force hold.';
