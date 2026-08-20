-- Align GiST overlap constraints with lz_booking_blocks_availability():
-- expired checkout holds (pending + expires_at) and expired staff holds (hold + hold_expires_at)
-- must not block new bookings at the database layer.

BEGIN;

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_boat_no_time_overlap;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_boat_no_time_overlap
  EXCLUDE USING gist (
    boat_id WITH =,
    tstzrange(start_time, end_time, '[)') WITH &&
  )
  WHERE (
    boat_id IS NOT NULL
    AND status IN (
      'hold',
      'pending',
      'pending_verification',
      'confirmed',
      'ready_for_departure',
      'completed'
    )
    AND NOT (
      booking_type = 'charter'
      AND charter_seating = 'shared'
    )
    AND NOT (
      status = 'pending'
      AND expires_at IS NOT NULL
      AND expires_at < now()
    )
    AND NOT (
      status = 'hold'
      AND hold_expires_at IS NOT NULL
      AND hold_expires_at < now()
    )
  );

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_fleet_exclusive_charter_no_overlap;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_fleet_exclusive_charter_no_overlap
  EXCLUDE USING gist (
    tstzrange(start_time, end_time, '[)') WITH &&
  )
  WHERE (
    boat_id IS NULL
    AND booking_type = 'charter'
    AND (charter_seating IS NULL OR charter_seating = 'private')
    AND status IN (
      'hold',
      'pending',
      'pending_verification',
      'confirmed',
      'ready_for_departure',
      'completed'
    )
    AND NOT (
      status = 'pending'
      AND expires_at IS NOT NULL
      AND expires_at < now()
    )
    AND NOT (
      status = 'hold'
      AND hold_expires_at IS NOT NULL
      AND hold_expires_at < now()
    )
  );

COMMENT ON CONSTRAINT bookings_boat_no_time_overlap ON public.bookings IS
  'Exclusive boat bookings cannot overlap; expired pending/staff holds are excluded.';

COMMENT ON CONSTRAINT bookings_fleet_exclusive_charter_no_overlap ON public.bookings IS
  'Fleet-wide exclusive charters cannot overlap; expired pending/staff holds are excluded.';

COMMIT;
