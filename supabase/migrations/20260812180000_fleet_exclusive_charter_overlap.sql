-- Backstop for legacy exclusive charters without boat assignment (boat_id IS NULL).
-- Shared charters with boat_id + charter_seating = 'shared' are protected by
-- bookings_shared_charter_capacity trigger; boat-assigned exclusive rows use GiST.

BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

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
  );

COMMENT ON CONSTRAINT bookings_fleet_exclusive_charter_no_overlap ON public.bookings IS
  'Prevents overlapping exclusive fleet-wide charter holds when boat_id is not yet assigned.';

COMMIT;
