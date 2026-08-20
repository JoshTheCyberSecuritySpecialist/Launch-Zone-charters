-- Expired holds must not block availability or overlap checks.
--
-- PostgreSQL GiST exclusion partial-index predicates must be IMMUTABLE, so
-- `expires_at < now()` cannot appear in constraint WHERE clauses. Instead:
-- 1) extend lz_booking_blocks_availability() for shared-capacity / triggers
-- 2) cancel expired hold rows so they drop out of blocking statuses
-- 3) server cleanupExpiredBookingHolds() continues on checkout + interval

BEGIN;

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
    )
    AND NOT (
      b.status = 'hold'
      AND b.hold_expires_at IS NOT NULL
      AND b.hold_expires_at < now()
    );
$$;

COMMENT ON FUNCTION public.lz_booking_blocks_availability(public.bookings) IS
  'True when a booking row should block availability, capacity, and overlap detection. Expired checkout and staff holds return false.';

-- Remove stale rows that still carry blocking statuses but are past expiry.
UPDATE public.bookings AS b
SET
  status = 'cancelled',
  admin_notes = CONCAT(
    COALESCE(b.admin_notes, ''),
    E'\n[20260819220000] Auto-cancelled expired hold during migration.'
  )
WHERE (
    b.status = 'pending'
    AND b.expires_at IS NOT NULL
    AND b.expires_at < now()
    AND b.stripe_payment_id IS NULL
  )
  OR (
    b.status = 'hold'
    AND b.hold_expires_at IS NOT NULL
    AND b.hold_expires_at < now()
  );

COMMIT;
