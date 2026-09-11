-- Allow bio_private to exclusive-lock the boat.
-- Shared bio packages (bio_solo/two/three/four and legacy bio rows) remain always-shared
-- even if charter_seating was stored as private. Rocket/sunset private packages unchanged.

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
    AND coalesce(p_pricing_package_id, '') IS DISTINCT FROM 'bio_private'
    AND (
      p_charter_seating = 'shared'
      OR lower(coalesce(p_charter_type, '')) IN ('bio', 'night_bio')
      OR coalesce(p_pricing_package_id, '') LIKE 'bio\_%' ESCAPE '\'
    );
$$;

COMMENT ON FUNCTION public.lz_is_shared_charter_booking(text, text, text, text) IS
  'True when a booking shares boat capacity. Bio/night_bio and bio_* packages are shared except bio_private, which exclusive-locks the boat.';

-- Keep historical shared bio rows on shared seating (do not rewrite bio_private).
ALTER TABLE public.bookings DISABLE TRIGGER bookings_shared_charter_capacity;

UPDATE public.bookings
SET charter_seating = 'shared'
WHERE booking_type = 'charter'
  AND (
    lower(coalesce(charter_type, '')) IN ('bio', 'night_bio')
    OR coalesce(pricing_package_id, '') LIKE 'bio\_%' ESCAPE '\'
  )
  AND coalesce(pricing_package_id, '') IS DISTINCT FROM 'bio_private'
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

ALTER TABLE public.bookings ENABLE TRIGGER bookings_shared_charter_capacity;

COMMIT;
