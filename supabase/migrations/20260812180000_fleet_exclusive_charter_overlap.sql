-- Backstop for legacy exclusive charters without boat assignment (boat_id IS NULL).
-- Shared charters with boat_id + charter_seating = 'shared' use the capacity trigger;
-- boat-assigned exclusive rows use bookings_boat_no_time_overlap.
--
-- Production may contain overbooked null-boat bio departures. Remediate safely, then
-- add the fleet-wide exclusive backstop constraint.

BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE OR REPLACE FUNCTION public.lz_default_charter_boat_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (
      SELECT id
      FROM public.boats
      WHERE is_active = true
        AND type = 'premium'
      ORDER BY created_at ASC
      LIMIT 1
    ),
    (
      SELECT id
      FROM public.boats
      WHERE is_active = true
      ORDER BY created_at ASC
      LIMIT 1
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.lz_migration_effective_guest_count(g integer)
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

-- Bulk remediation must not fire per-row shared capacity checks mid-update.
ALTER TABLE public.bookings DISABLE TRIGGER bookings_shared_charter_capacity;

-- A) Drop expired checkout holds.
UPDATE public.bookings AS b
SET
  status = 'cancelled',
  admin_notes = CONCAT(
    COALESCE(b.admin_notes, ''),
    E'\n[20260812180000] Auto-cancelled expired pending hold during migration.'
  )
WHERE b.booking_type = 'charter'
  AND b.boat_id IS NULL
  AND b.status = 'pending'
  AND b.expires_at IS NOT NULL
  AND b.expires_at < now();

-- B) Exact duplicate departure windows on null-boat fleet charters.
WITH exact_dupes AS (
  SELECT
    b.id,
    ROW_NUMBER() OVER (
      PARTITION BY b.start_time, b.end_time
      ORDER BY b.created_at ASC NULLS LAST, b.id ASC
    ) AS rn
  FROM public.bookings AS b
  WHERE b.boat_id IS NULL
    AND b.booking_type = 'charter'
    AND (b.charter_seating IS NULL OR b.charter_seating = 'private')
    AND b.status IN (
      'hold',
      'pending',
      'pending_verification',
      'confirmed',
      'ready_for_departure',
      'completed'
    )
)
UPDATE public.bookings AS b
SET
  status = 'cancelled',
  admin_notes = CONCAT(
    COALESCE(b.admin_notes, ''),
    E'\n[20260812180000] Auto-cancelled exact duplicate fleet charter slot during migration.'
  )
FROM exact_dupes AS d
WHERE b.id = d.id
  AND d.rn > 1;

-- C) Overlapping null-boat fleet exclusives — keep stronger booking.
UPDATE public.bookings AS loser
SET
  status = 'cancelled',
  admin_notes = CONCAT(
    COALESCE(loser.admin_notes, ''),
    E'\n[20260812180000] Auto-cancelled duplicate overlapping fleet charter during migration.'
  )
WHERE loser.boat_id IS NULL
  AND loser.booking_type = 'charter'
  AND (loser.charter_seating IS NULL OR loser.charter_seating = 'private')
  AND loser.status IN (
    'hold',
    'pending',
    'pending_verification',
    'confirmed',
    'ready_for_departure',
    'completed'
  )
  AND EXISTS (
    SELECT 1
    FROM public.bookings AS winner
    WHERE winner.id <> loser.id
      AND winner.boat_id IS NULL
      AND winner.booking_type = 'charter'
      AND (winner.charter_seating IS NULL OR winner.charter_seating = 'private')
      AND winner.status IN (
        'hold',
        'pending',
        'pending_verification',
        'confirmed',
        'ready_for_departure',
        'completed'
      )
      AND tstzrange(winner.start_time, winner.end_time, '[)')
        && tstzrange(loser.start_time, loser.end_time, '[)')
      AND (
        CASE winner.status
          WHEN 'ready_for_departure' THEN 1
          WHEN 'confirmed' THEN 2
          WHEN 'completed' THEN 3
          WHEN 'pending_verification' THEN 4
          WHEN 'pending' THEN 5
          WHEN 'hold' THEN 6
          ELSE 99
        END
        <
        CASE loser.status
          WHEN 'ready_for_departure' THEN 1
          WHEN 'confirmed' THEN 2
          WHEN 'completed' THEN 3
          WHEN 'pending_verification' THEN 4
          WHEN 'pending' THEN 5
          WHEN 'hold' THEN 6
          ELSE 99
        END
        OR (
          winner.status = loser.status
          AND (
            winner.created_at < loser.created_at
            OR (winner.created_at = loser.created_at AND winner.id < loser.id)
          )
        )
      )
  );

-- D) Bio/night departures: cancel bookings that would exceed 5 guests once merged onto one boat.
WITH bio_slot AS (
  SELECT
    b.id,
    public.lz_migration_effective_guest_count(b.guest_count) AS effective_guests,
    SUM(public.lz_migration_effective_guest_count(b.guest_count)) OVER (
      PARTITION BY b.start_time, b.end_time
      ORDER BY
        CASE b.status
          WHEN 'ready_for_departure' THEN 1
          WHEN 'confirmed' THEN 2
          WHEN 'completed' THEN 3
          WHEN 'pending_verification' THEN 4
          WHEN 'pending' THEN 5
          WHEN 'hold' THEN 6
          ELSE 99
        END,
        b.created_at ASC NULLS LAST,
        b.id ASC
    ) AS cum_guests
  FROM public.bookings AS b
  WHERE b.booking_type = 'charter'
    AND b.boat_id IS NULL
    AND b.status IN (
      'hold',
      'pending',
      'pending_verification',
      'confirmed',
      'ready_for_departure',
      'completed'
    )
    AND (
      b.charter_type IN ('bio', 'night_bio', 'rocket', 'rocket_launch')
      OR b.is_night_tour IS TRUE
    )
)
UPDATE public.bookings AS b
SET
  status = 'cancelled',
  admin_notes = CONCAT(
    COALESCE(b.admin_notes, ''),
    E'\n[20260812180000] Auto-cancelled over-capacity bio departure during migration.'
  )
FROM bio_slot AS s
WHERE b.id = s.id
  AND (
    s.cum_guests > 5
    OR (s.cum_guests - s.effective_guests) >= 5
  );

-- E) Backfill remaining bio/night/rocket charters onto the default vessel as shared.
UPDATE public.bookings AS b
SET
  charter_seating = 'shared',
  boat_id = COALESCE(b.boat_id, public.lz_default_charter_boat_id())
WHERE b.booking_type = 'charter'
  AND b.boat_id IS NULL
  AND (b.charter_seating IS NULL OR b.charter_seating = 'private')
  AND b.status IN (
    'hold',
    'pending',
    'pending_verification',
    'confirmed',
    'ready_for_departure',
    'completed'
  )
  AND (
    b.charter_type IN ('bio', 'night_bio', 'rocket', 'rocket_launch')
    OR b.is_night_tour IS TRUE
  );

-- F) Assign any remaining null-boat charters to the default vessel as private/exclusive.
UPDATE public.bookings AS b
SET
  boat_id = public.lz_default_charter_boat_id(),
  charter_seating = COALESCE(NULLIF(b.charter_seating, ''), 'private')
WHERE b.booking_type = 'charter'
  AND b.boat_id IS NULL
  AND b.status IN (
    'hold',
    'pending',
    'pending_verification',
    'confirmed',
    'ready_for_departure',
    'completed'
  );

ALTER TABLE public.bookings ENABLE TRIGGER bookings_shared_charter_capacity;

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
  );

COMMENT ON CONSTRAINT bookings_fleet_exclusive_charter_no_overlap ON public.bookings IS
  'Prevents overlapping exclusive fleet-wide charter holds when boat_id is not yet assigned.';

DROP FUNCTION IF EXISTS public.lz_migration_effective_guest_count(integer);
DROP FUNCTION IF EXISTS public.lz_default_charter_boat_id();

COMMIT;
