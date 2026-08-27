-- Bioluminescence charters are always shared seating.
-- Website checkout historically sent charterVariant=private, which exclusive-locked
-- the boat after the first party booked. Remaining seats could not be sold.
-- Rocket/sunset private packages are unchanged.

BEGIN;

CREATE OR REPLACE FUNCTION public.lz_is_shared_charter_booking(
  p_booking_type text,
  p_charter_seating text,
  p_charter_type text,
  p_pricing_package_id text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    p_booking_type = 'charter'
    AND (
      p_charter_seating = 'shared'
      OR lower(coalesce(p_charter_type, '')) IN ('bio', 'night_bio')
      OR coalesce(p_pricing_package_id, '') LIKE 'bio\_%' ESCAPE '\'
    );
$$;

COMMENT ON FUNCTION public.lz_is_shared_charter_booking(text, text, text, text) IS
  'True when a booking shares boat capacity. Bio/night_bio and bio_* packages are always shared, even if charter_seating was stored as private.';

ALTER TABLE public.bookings DISABLE TRIGGER bookings_shared_charter_capacity;

UPDATE public.bookings
SET charter_seating = 'shared'
WHERE booking_type = 'charter'
  AND (
    lower(coalesce(charter_type, '')) IN ('bio', 'night_bio')
    OR coalesce(pricing_package_id, '') LIKE 'bio\_%' ESCAPE '\'
  )
  AND charter_seating IS DISTINCT FROM 'shared';

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
    AND NOT public.lz_is_shared_charter_booking(
      booking_type,
      charter_seating,
      charter_type,
      pricing_package_id
    )
  );

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

  IF NOT public.lz_is_shared_charter_booking(
    NEW.booking_type,
    NEW.charter_seating,
    NEW.charter_type,
    NEW.pricing_package_id
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
      AND NOT public.lz_is_shared_charter_booking(
        b.booking_type,
        b.charter_seating,
        b.charter_type,
        b.pricing_package_id
      )
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
    AND public.lz_is_shared_charter_booking(
      b.booking_type,
      b.charter_seating,
      b.charter_type,
      b.pricing_package_id
    )
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
  BEFORE INSERT OR UPDATE OF boat_id, start_time, end_time, guest_count, status, charter_seating, booking_type, charter_type, pricing_package_id
  ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.lz_assert_shared_charter_capacity();

ALTER TABLE public.bookings ENABLE TRIGGER bookings_shared_charter_capacity;

COMMIT;
