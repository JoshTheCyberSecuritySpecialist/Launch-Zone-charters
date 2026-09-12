-- Atomic charter fleet boat pick under a transaction advisory lock.
-- Node resolves ordered fleet boat UUIDs and calls this before hold insert / finalize.
-- Existing GiST + lz_assert_shared_charter_capacity remain the hard capacity backstop.

BEGIN;

CREATE OR REPLACE FUNCTION public.lz_pick_charter_fleet_boat(
  p_boat_ids uuid[],
  p_start timestamptz,
  p_end timestamptz,
  p_guest_count integer,
  p_exclude_booking_id uuid DEFAULT NULL,
  p_mode text DEFAULT 'shared',
  p_preferred_boat_id uuid DEFAULT NULL,
  p_sticky boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode text := lower(coalesce(nullif(trim(p_mode), ''), 'shared'));
  v_guests integer := public.lz_effective_charter_guest_count(p_guest_count);
  v_boat_id uuid;
  v_used integer;
  v_remaining integer;
  v_fleet_used integer := 0;
  v_has_exclusive boolean;
  v_partial_id uuid := NULL;
  v_empty_id uuid := NULL;
  v_candidate_used integer;
  v_lock_key integer;
BEGIN
  IF p_boat_ids IS NULL OR cardinality(p_boat_ids) < 1 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'boat_id', NULL,
      'reason', 'no_boat',
      'message', 'Charter boat is not available for this departure. Please call us for help.'
    );
  END IF;

  IF p_start IS NULL OR p_end IS NULL OR p_end <= p_start THEN
    RETURN jsonb_build_object(
      'ok', false,
      'boat_id', NULL,
      'reason', 'invalid_slot',
      'message', 'That departure just filled. Please select the next available time.'
    );
  END IF;

  -- Serialize concurrent pickers for the same departure window.
  v_lock_key := hashtext(p_start::text || '|' || p_end::text || '|' || array_to_string(p_boat_ids, ','));
  PERFORM pg_advisory_xact_lock(88112233, v_lock_key);

  -- Sticky preferred boat (finalize): keep assignment when it still fits.
  IF p_sticky AND p_preferred_boat_id IS NOT NULL AND p_preferred_boat_id = ANY (p_boat_ids) THEN
    IF v_mode = 'private' THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.bookings b
        WHERE b.boat_id = p_preferred_boat_id
          AND b.id IS DISTINCT FROM p_exclude_booking_id
          AND public.lz_booking_blocks_availability(b)
          AND tstzrange(b.start_time, b.end_time, '[)') && tstzrange(p_start, p_end, '[)')
      )
      INTO v_has_exclusive;

      IF NOT v_has_exclusive THEN
        RETURN jsonb_build_object(
          'ok', true,
          'boat_id', p_preferred_boat_id,
          'reason', NULL,
          'used', 0,
          'remaining', 5,
          'fleet_used', 0,
          'sticky', true
        );
      END IF;
    ELSE
      SELECT EXISTS (
        SELECT 1
        FROM public.bookings b
        WHERE b.boat_id = p_preferred_boat_id
          AND b.id IS DISTINCT FROM p_exclude_booking_id
          AND public.lz_booking_blocks_availability(b)
          AND NOT public.lz_is_shared_charter_booking(
            b.booking_type,
            b.charter_seating,
            b.charter_type,
            b.pricing_package_id
          )
          AND tstzrange(b.start_time, b.end_time, '[)') && tstzrange(p_start, p_end, '[)')
      )
      INTO v_has_exclusive;

      IF NOT v_has_exclusive THEN
        SELECT COALESCE(SUM(public.lz_effective_charter_guest_count(b.guest_count)), 0)
        INTO v_used
        FROM public.bookings b
        WHERE b.boat_id = p_preferred_boat_id
          AND b.id IS DISTINCT FROM p_exclude_booking_id
          AND public.lz_booking_blocks_availability(b)
          AND public.lz_is_shared_charter_booking(
            b.booking_type,
            b.charter_seating,
            b.charter_type,
            b.pricing_package_id
          )
          AND tstzrange(b.start_time, b.end_time, '[)') && tstzrange(p_start, p_end, '[)');

        IF v_used + v_guests <= 5 THEN
          RETURN jsonb_build_object(
            'ok', true,
            'boat_id', p_preferred_boat_id,
            'reason', NULL,
            'used', v_used,
            'remaining', GREATEST(0, 5 - v_used - v_guests),
            'fleet_used', v_used,
            'sticky', true
          );
        END IF;
      END IF;
    END IF;
    -- Sticky boat no longer fits — fall through to normal fleet pick (e.g. console).
  END IF;

  FOREACH v_boat_id IN ARRAY p_boat_ids
  LOOP
    IF v_mode = 'private' THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.bookings b
        WHERE b.boat_id = v_boat_id
          AND b.id IS DISTINCT FROM p_exclude_booking_id
          AND public.lz_booking_blocks_availability(b)
          AND tstzrange(b.start_time, b.end_time, '[)') && tstzrange(p_start, p_end, '[)')
      )
      INTO v_has_exclusive;

      IF NOT v_has_exclusive AND v_empty_id IS NULL THEN
        v_empty_id := v_boat_id;
      END IF;
    ELSE
      SELECT EXISTS (
        SELECT 1
        FROM public.bookings b
        WHERE b.boat_id = v_boat_id
          AND b.id IS DISTINCT FROM p_exclude_booking_id
          AND public.lz_booking_blocks_availability(b)
          AND NOT public.lz_is_shared_charter_booking(
            b.booking_type,
            b.charter_seating,
            b.charter_type,
            b.pricing_package_id
          )
          AND tstzrange(b.start_time, b.end_time, '[)') && tstzrange(p_start, p_end, '[)')
      )
      INTO v_has_exclusive;

      IF v_has_exclusive THEN
        CONTINUE;
      END IF;

      SELECT COALESCE(SUM(public.lz_effective_charter_guest_count(b.guest_count)), 0)
      INTO v_candidate_used
      FROM public.bookings b
      WHERE b.boat_id = v_boat_id
        AND b.id IS DISTINCT FROM p_exclude_booking_id
        AND public.lz_booking_blocks_availability(b)
        AND public.lz_is_shared_charter_booking(
          b.booking_type,
          b.charter_seating,
          b.charter_type,
          b.pricing_package_id
        )
        AND tstzrange(b.start_time, b.end_time, '[)') && tstzrange(p_start, p_end, '[)');

      v_fleet_used := v_fleet_used + v_candidate_used;

      IF v_candidate_used + v_guests <= 5 THEN
        IF v_candidate_used > 0 AND v_partial_id IS NULL THEN
          v_partial_id := v_boat_id;
        ELSIF v_candidate_used = 0 AND v_empty_id IS NULL THEN
          v_empty_id := v_boat_id;
        END IF;
      END IF;
    END IF;
  END LOOP;

  v_boat_id := COALESCE(v_partial_id, v_empty_id);
  IF v_boat_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'boat_id', NULL,
      'reason', 'charter_capacity',
      'message', 'That departure just filled. Please select the next available time.',
      'fleet_used', v_fleet_used
    );
  END IF;

  IF v_mode = 'private' THEN
    v_used := 0;
    v_remaining := 5;
  ELSE
    SELECT COALESCE(SUM(public.lz_effective_charter_guest_count(b.guest_count)), 0)
    INTO v_used
    FROM public.bookings b
    WHERE b.boat_id = v_boat_id
      AND b.id IS DISTINCT FROM p_exclude_booking_id
      AND public.lz_booking_blocks_availability(b)
      AND public.lz_is_shared_charter_booking(
        b.booking_type,
        b.charter_seating,
        b.charter_type,
        b.pricing_package_id
      )
      AND tstzrange(b.start_time, b.end_time, '[)') && tstzrange(p_start, p_end, '[)');
    v_remaining := GREATEST(0, 5 - v_used - v_guests);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'boat_id', v_boat_id,
    'reason', NULL,
    'used', v_used,
    'remaining', v_remaining,
    'fleet_used', v_fleet_used,
    'sticky', false
  );
END;
$$;

COMMENT ON FUNCTION public.lz_pick_charter_fleet_boat(uuid[], timestamptz, timestamptz, integer, uuid, text, uuid, boolean) IS
  'Atomically pick a captain-led charter boat for a departure under pg_advisory_xact_lock. Boat UUID order is priority (pontoon first).';

REVOKE ALL ON FUNCTION public.lz_pick_charter_fleet_boat(uuid[], timestamptz, timestamptz, integer, uuid, text, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lz_pick_charter_fleet_boat(uuid[], timestamptz, timestamptz, integer, uuid, text, uuid, boolean) TO service_role;

COMMIT;
