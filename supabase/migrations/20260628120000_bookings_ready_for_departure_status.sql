-- Operator workflow: mark approved rentals/charters ready for pickup/departure.
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_status_check CHECK (
    status IN (
      'pending',
      'pending_verification',
      'confirmed',
      'ready_for_departure',
      'cancelled',
      'completed'
    )
  );

COMMENT ON COLUMN public.bookings.status IS
  'pending = unpaid hold; pending_verification = paid, docs review; confirmed = approved; ready_for_departure = cleared for trip; cancelled; completed';
