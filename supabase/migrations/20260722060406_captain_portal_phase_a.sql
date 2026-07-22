-- Phase A: Captain Portal schema — captains table, booking assignment, progress, emergency notes.
-- Captains see only assigned captain_charter bookings (enforced in RLS + CHECK).

BEGIN;

-- ---------------------------------------------------------------------------
-- captains: crew identity linked to Supabase auth (separate from admins / captains_log)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.captains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  full_name text NOT NULL,
  phone text,
  email text UNIQUE,
  photo_url text,
  active boolean NOT NULL DEFAULT true,
  default_boat_id uuid REFERENCES public.boats(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.captains IS
  'Licensed captains with portal access. Distinct from captains_log (marketing blog).';
COMMENT ON COLUMN public.captains.auth_user_id IS
  'Supabase auth user id; same user may also exist in admins for dual admin+captain role.';
COMMENT ON COLUMN public.captains.active IS
  'Inactive captains cannot authenticate to the captain portal.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_captains_auth_user_id
  ON public.captains (auth_user_id)
  WHERE auth_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_captains_active
  ON public.captains (active)
  WHERE active = true;

CREATE INDEX IF NOT EXISTS idx_captains_default_boat
  ON public.captains (default_boat_id)
  WHERE default_boat_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.set_captains_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_captains_updated_at ON public.captains;
CREATE TRIGGER trg_captains_updated_at
  BEFORE UPDATE ON public.captains
  FOR EACH ROW
  EXECUTE FUNCTION public.set_captains_updated_at();

-- ---------------------------------------------------------------------------
-- bookings: captain assignment, on-trip progress, emergency contact notes
-- ---------------------------------------------------------------------------
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS captain_id uuid REFERENCES public.captains(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS captain_progress text NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS emergency_contact_notes text;

COMMENT ON COLUMN public.bookings.captain_id IS
  'Assigned captain (FK). Only valid for booking_type=charter and charter_type=captain_charter.';
COMMENT ON COLUMN public.bookings.captain_progress IS
  'Captain-reported trip progress; does not replace bookings.status lifecycle.';
COMMENT ON COLUMN public.bookings.emergency_contact_notes IS
  'Emergency contact name/relationship/phone — not the booking customer phone.';

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_captain_progress_check;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_captain_progress_check CHECK (
    captain_progress IN ('not_started', 'arrived', 'in_progress', 'completed')
  );

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_captain_charter_assignment_check;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_captain_charter_assignment_check CHECK (
    captain_id IS NULL
    OR (
      booking_type = 'charter'
      AND charter_type = 'captain_charter'
    )
  );

CREATE INDEX IF NOT EXISTS idx_bookings_captain_id
  ON public.bookings (captain_id)
  WHERE captain_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_captain_start
  ON public.bookings (captain_id, start_time)
  WHERE captain_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_captain_charter_schedule
  ON public.bookings (captain_id, start_time, status)
  WHERE captain_id IS NOT NULL
    AND booking_type = 'charter'
    AND charter_type = 'captain_charter';

-- ---------------------------------------------------------------------------
-- RLS helpers: captain identity (mirrors lz_is_admin email fallback pattern)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lz_current_captain_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id
  FROM public.captains c
  WHERE c.active = true
    AND (
      c.auth_user_id = auth.uid()
      OR (
        c.email IS NOT NULL
        AND (auth.jwt() ->> 'email') IS NOT NULL
        AND lower(trim(c.email)) = lower(trim(auth.jwt() ->> 'email'))
      )
    )
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.lz_is_captain()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.lz_current_captain_id() IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.lz_current_captain_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lz_is_captain() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lz_current_captain_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.lz_is_captain() TO authenticated;

CREATE OR REPLACE FUNCTION public.lz_is_captain_charter_booking(p_booking_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.bookings b
    WHERE b.id = p_booking_id
      AND b.captain_id = public.lz_current_captain_id()
      AND b.booking_type = 'charter'
      AND b.charter_type = 'captain_charter'
  );
$$;

REVOKE ALL ON FUNCTION public.lz_is_captain_charter_booking(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lz_is_captain_charter_booking(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- RLS: captains table
-- ---------------------------------------------------------------------------
ALTER TABLE public.captains ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Captains read own profile" ON public.captains;
CREATE POLICY "Captains read own profile"
  ON public.captains FOR SELECT
  TO authenticated
  USING (id = public.lz_current_captain_id());

DROP POLICY IF EXISTS "Admins manage captains" ON public.captains;
CREATE POLICY "Admins manage captains"
  ON public.captains FOR ALL
  TO authenticated
  USING (public.lz_is_admin())
  WITH CHECK (public.lz_is_admin());

-- ---------------------------------------------------------------------------
-- RLS: captain-scoped read on assigned captain_charter bookings
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Captains read assigned captain charter bookings" ON public.bookings;
CREATE POLICY "Captains read assigned captain charter bookings"
  ON public.bookings FOR SELECT
  TO authenticated
  USING (
    public.lz_is_captain()
    AND captain_id = public.lz_current_captain_id()
    AND booking_type = 'charter'
    AND charter_type = 'captain_charter'
  );

-- Progress updates go through server API (service role + verifyCaptainRequest) in Phase C.
-- No direct captain UPDATE on bookings — prevents privilege escalation via Supabase client.

-- ---------------------------------------------------------------------------
-- RLS: customers visible to captain only for assigned charter bookings
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Captains view customers for assigned captain charter bookings" ON public.customers;
CREATE POLICY "Captains view customers for assigned captain charter bookings"
  ON public.customers FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.bookings b
      WHERE b.customer_id = customers.id
        AND b.captain_id = public.lz_current_captain_id()
        AND b.booking_type = 'charter'
        AND b.charter_type = 'captain_charter'
    )
  );

-- ---------------------------------------------------------------------------
-- RLS: passenger manifest for assigned captain charter bookings
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Captains read passengers for assigned captain charter bookings" ON public.booking_passengers;
CREATE POLICY "Captains read passengers for assigned captain charter bookings"
  ON public.booking_passengers FOR SELECT
  TO authenticated
  USING (
    booking_id IS NOT NULL
    AND public.lz_is_captain_charter_booking(booking_id)
  );

COMMIT;

NOTIFY pgrst, 'reload schema';
