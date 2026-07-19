-- Shared captain-led charters: multiple bookings per boat/time up to 5 passengers total.
-- Exclusive rentals/private charters keep GiST overlap prevention.

BEGIN;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS charter_seating text;

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_charter_seating_check;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_charter_seating_check
  CHECK (charter_seating IS NULL OR charter_seating IN ('shared', 'private'));

COMMENT ON COLUMN public.bookings.charter_seating IS
  'shared = capacity-based seating on assigned boat; private = exclusive boat slot; NULL = legacy/exclusive.';

UPDATE public.bookings
SET charter_seating = 'shared'
WHERE booking_type = 'charter'
  AND charter_type = 'captain_charter'
  AND boat_id IS NOT NULL
  AND (charter_seating IS NULL OR charter_seating = '');

CREATE EXTENSION IF NOT EXISTS btree_gist;

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
  );

CREATE OR REPLACE FUNCTION public.lz_booking_blocks_availability(b public.bookings)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT
    b.status IN (
      'hold',
      'pending',
      'pending_verification',
      'confirmed',
      'ready_for_departure',
      'completed'
    )
    AND NOT (
      b.status = 'pending'
      AND b.expires_at IS NOT NULL
      AND b.expires_at < now()
    );
$$;

CREATE OR REPLACE FUNCTION public.lz_effective_charter_guest_count(g integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN g IS NULL OR g < 1 THEN 5
    WHEN g > 5 THEN 5
    ELSE g
  END;
$$;

CREATE OR REPLACE FUNCTION public.lz_assert_shared_charter_capacity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  used integer;
  proposed integer;
  remaining integer;
BEGIN
  IF NEW.boat_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT (
    NEW.booking_type = 'charter'
    AND NEW.charter_seating = 'shared'
  ) THEN
    RETURN NEW;
  END IF;

  IF NOT public.lz_booking_blocks_availability(NEW) THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.bookings b
    WHERE b.boat_id = NEW.boat_id
      AND b.id IS DISTINCT FROM NEW.id
      AND public.lz_booking_blocks_availability(b)
      AND NOT (b.booking_type = 'charter' AND b.charter_seating = 'shared')
      AND tstzrange(b.start_time, b.end_time, '[)') && tstzrange(NEW.start_time, NEW.end_time, '[)')
  ) THEN
    RAISE EXCEPTION 'shared_charter_exclusive_conflict'
      USING ERRCODE = 'check_violation';
  END IF;

  proposed := public.lz_effective_charter_guest_count(NEW.guest_count);

  SELECT COALESCE(SUM(public.lz_effective_charter_guest_count(b.guest_count)), 0)
  INTO used
  FROM public.bookings b
  WHERE b.boat_id = NEW.boat_id
    AND b.id IS DISTINCT FROM NEW.id
    AND public.lz_booking_blocks_availability(b)
    AND b.booking_type = 'charter'
    AND b.charter_seating = 'shared'
    AND tstzrange(b.start_time, b.end_time, '[)') && tstzrange(NEW.start_time, NEW.end_time, '[)');

  IF used + proposed > 5 THEN
    remaining := GREATEST(0, 5 - used);
    RAISE EXCEPTION 'shared_charter_capacity_exceeded:%', remaining
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bookings_shared_charter_capacity ON public.bookings;
CREATE TRIGGER bookings_shared_charter_capacity
  BEFORE INSERT OR UPDATE OF boat_id, start_time, end_time, guest_count, status, charter_seating, booking_type
  ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.lz_assert_shared_charter_capacity();

COMMIT;
