-- Harden bookings RLS so direct client inserts cannot bypass
-- payment + waiver checks enforced by backend checkout flow.
--
-- Guardrails:
-- - Keep existing admin policy/access intact.
-- - Keep existing read policies intact (including verify flow policies).
-- - Backend service role continues to work (service role bypasses RLS).

BEGIN;

-- Remove legacy permissive insert policy from base schema migration.
DROP POLICY IF EXISTS "Anyone can create bookings" ON public.bookings;

-- Defensive cleanup for potential variant policy names.
DROP POLICY IF EXISTS "Anyone can insert bookings" ON public.bookings;
DROP POLICY IF EXISTS "Public can create bookings" ON public.bookings;
DROP POLICY IF EXISTS "Anon can create bookings" ON public.bookings;

-- No replacement INSERT policy is added for anon/authenticated users.
-- Result: direct client-side INSERTs are blocked by default RLS deny.
-- Admin access remains through existing:
--   "Admins can manage all bookings" (FOR ALL TO authenticated USING/WITH CHECK public.lz_is_admin()).

COMMIT;

