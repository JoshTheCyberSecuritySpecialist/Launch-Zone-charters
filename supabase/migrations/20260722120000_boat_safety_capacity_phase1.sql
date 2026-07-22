-- Phase 1: Boat Safety Capacity Calculator — schema + admin-only capacity profiles.
-- Public calculator (Phase 3) and server math (Phase 2) are not included here.
--
-- Sensitive plate/weight limits live in boat_capacity_profiles (admin RLS only).
-- boats keeps public-safe vessel metadata; existing marketing `capacity` column unchanged.

BEGIN;

-- ---------------------------------------------------------------------------
-- boats: public-safe vessel metadata
-- ---------------------------------------------------------------------------
ALTER TABLE public.boats
  ADD COLUMN IF NOT EXISTS year integer,
  ADD COLUMN IF NOT EXISTS manufacturer text,
  ADD COLUMN IF NOT EXISTS model text,
  ADD COLUMN IF NOT EXISTS length_feet numeric(4, 1),
  ADD COLUMN IF NOT EXISTS engine_description text;

COMMENT ON COLUMN public.boats.year IS 'Model year from registration or manufacturer docs.';
COMMENT ON COLUMN public.boats.manufacturer IS 'Boat manufacturer (e.g. Key Largo, SunCatcher).';
COMMENT ON COLUMN public.boats.model IS 'Model name/number from registration or manufacturer docs.';
COMMENT ON COLUMN public.boats.length_feet IS 'Overall length in feet (approximate OK for admin reference).';
COMMENT ON COLUMN public.boats.engine_description IS 'Engine make/model/HP for admin reference.';

-- ---------------------------------------------------------------------------
-- boat_capacity_profiles: admin-only USCG plate limits (never guess values)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.boat_capacity_profiles (
  boat_id uuid PRIMARY KEY REFERENCES public.boats(id) ON DELETE CASCADE,
  registration_number text,
  maximum_persons integer,
  maximum_persons_weight_lbs numeric(8, 2),
  maximum_total_load_lbs numeric(8, 2),
  operator_weight_lbs numeric(8, 2),
  standard_equipment_weight_lbs numeric(8, 2) NOT NULL DEFAULT 0,
  fuel_allowance_weight_lbs numeric(8, 2) NOT NULL DEFAULT 0,
  safety_buffer_lbs numeric(8, 2) NOT NULL DEFAULT 0,
  warning_threshold_percent numeric(5, 2) NOT NULL DEFAULT 85,
  capacity_plate_photo_path text,
  capacity_source text,
  capacity_verified boolean NOT NULL DEFAULT false,
  capacity_verified_at timestamptz,
  capacity_verified_by uuid REFERENCES public.admins(id) ON DELETE SET NULL,
  config_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT boat_capacity_profiles_warning_threshold_check CHECK (
    warning_threshold_percent > 0 AND warning_threshold_percent <= 100
  ),
  CONSTRAINT boat_capacity_profiles_maximum_persons_check CHECK (
    maximum_persons IS NULL OR maximum_persons > 0
  ),
  CONSTRAINT boat_capacity_profiles_positive_weights_check CHECK (
    (maximum_persons_weight_lbs IS NULL OR maximum_persons_weight_lbs > 0)
    AND (maximum_total_load_lbs IS NULL OR maximum_total_load_lbs > 0)
    AND (operator_weight_lbs IS NULL OR operator_weight_lbs > 0)
    AND standard_equipment_weight_lbs >= 0
    AND fuel_allowance_weight_lbs >= 0
    AND safety_buffer_lbs >= 0
  )
);

COMMENT ON TABLE public.boat_capacity_profiles IS
  'Verified USCG capacity-plate limits per boat. Admin-only; public calculator blocked until capacity_verified.';

CREATE INDEX IF NOT EXISTS idx_boat_capacity_profiles_verified
  ON public.boat_capacity_profiles (capacity_verified, boat_id);

-- Auto-create profile row when a boat is inserted.
CREATE OR REPLACE FUNCTION public.lz_ensure_boat_capacity_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.boat_capacity_profiles (boat_id)
  VALUES (NEW.id)
  ON CONFLICT (boat_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lz_boats_ensure_capacity_profile ON public.boats;
CREATE TRIGGER lz_boats_ensure_capacity_profile
  AFTER INSERT ON public.boats
  FOR EACH ROW
  EXECUTE FUNCTION public.lz_ensure_boat_capacity_profile();

-- Backfill profiles for existing boats.
INSERT INTO public.boat_capacity_profiles (boat_id)
SELECT b.id
FROM public.boats b
ON CONFLICT (boat_id) DO NOTHING;

-- Bump config_version when verified plate limits change (audit for Phase 4).
CREATE OR REPLACE FUNCTION public.lz_bump_boat_capacity_config_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  IF TG_OP = 'UPDATE' AND (
    NEW.maximum_persons IS DISTINCT FROM OLD.maximum_persons
    OR NEW.maximum_persons_weight_lbs IS DISTINCT FROM OLD.maximum_persons_weight_lbs
    OR NEW.maximum_total_load_lbs IS DISTINCT FROM OLD.maximum_total_load_lbs
    OR NEW.operator_weight_lbs IS DISTINCT FROM OLD.operator_weight_lbs
    OR NEW.standard_equipment_weight_lbs IS DISTINCT FROM OLD.standard_equipment_weight_lbs
    OR NEW.fuel_allowance_weight_lbs IS DISTINCT FROM OLD.fuel_allowance_weight_lbs
    OR NEW.safety_buffer_lbs IS DISTINCT FROM OLD.safety_buffer_lbs
    OR NEW.warning_threshold_percent IS DISTINCT FROM OLD.warning_threshold_percent
    OR NEW.capacity_verified IS DISTINCT FROM OLD.capacity_verified
  ) THEN
    NEW.config_version = COALESCE(OLD.config_version, 1) + 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lz_boat_capacity_profiles_bump_version ON public.boat_capacity_profiles;
CREATE TRIGGER lz_boat_capacity_profiles_bump_version
  BEFORE UPDATE ON public.boat_capacity_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.lz_bump_boat_capacity_config_version();

-- ---------------------------------------------------------------------------
-- booking_passengers: manifest rows (Phase 3 writes; admin reads in Phase 4)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.booking_passengers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid REFERENCES public.bookings(id) ON DELETE CASCADE,
  pre_trip_submission_id uuid REFERENCES public.pre_trip_submissions(id) ON DELETE CASCADE,
  passenger_number integer NOT NULL,
  passenger_name text NOT NULL,
  passenger_type text NOT NULL CHECK (passenger_type IN ('adult', 'child', 'infant')),
  weight_lbs numeric(8, 2) NOT NULL,
  life_jacket_size text,
  mobility_assistance_required boolean NOT NULL DEFAULT false,
  mobility_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_passengers_parent_check CHECK (
    booking_id IS NOT NULL OR pre_trip_submission_id IS NOT NULL
  ),
  CONSTRAINT booking_passengers_weight_check CHECK (weight_lbs > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_passengers_booking_number
  ON public.booking_passengers (booking_id, passenger_number)
  WHERE booking_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_passengers_pretrip_number
  ON public.booking_passengers (pre_trip_submission_id, passenger_number)
  WHERE pre_trip_submission_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_booking_passengers_booking
  ON public.booking_passengers (booking_id)
  WHERE booking_id IS NOT NULL;

COMMENT ON TABLE public.booking_passengers IS
  'Passenger manifest with weights for boat safety calculator. Admin/service-role only.';

-- ---------------------------------------------------------------------------
-- booking_capacity_calculations: saved calculator snapshots (Phase 2+)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.booking_capacity_calculations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid REFERENCES public.bookings(id) ON DELETE CASCADE,
  pre_trip_submission_id uuid REFERENCES public.pre_trip_submissions(id) ON DELETE CASCADE,
  boat_id uuid NOT NULL REFERENCES public.boats(id) ON DELETE RESTRICT,
  config_version integer NOT NULL DEFAULT 1,
  passenger_count integer NOT NULL DEFAULT 0,
  total_persons_aboard integer NOT NULL DEFAULT 0,
  passenger_weight_total_lbs numeric(10, 2) NOT NULL DEFAULT 0,
  operator_weight_lbs numeric(8, 2) NOT NULL DEFAULT 0,
  cooler_weight_lbs numeric(8, 2) NOT NULL DEFAULT 0,
  personal_gear_weight_lbs numeric(8, 2) NOT NULL DEFAULT 0,
  other_equipment_weight_lbs numeric(8, 2) NOT NULL DEFAULT 0,
  other_equipment_description text,
  estimated_operating_load_lbs numeric(10, 2) NOT NULL DEFAULT 0,
  operational_weight_limit_lbs numeric(10, 2),
  remaining_margin_lbs numeric(10, 2),
  capacity_percent numeric(6, 2),
  status text NOT NULL DEFAULT 'capacity_unverified' CHECK (
    status IN (
      'within_operating_range',
      'captain_review_required',
      'capacity_exceeded',
      'capacity_unverified'
    )
  ),
  threshold_band text CHECK (threshold_band IN ('green', 'yellow', 'red')),
  customer_confirmed_at timestamptz,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_capacity_calculations_parent_check CHECK (
    booking_id IS NOT NULL OR pre_trip_submission_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_booking_capacity_calculations_booking
  ON public.booking_capacity_calculations (booking_id, calculated_at DESC)
  WHERE booking_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_booking_capacity_calculations_status
  ON public.booking_capacity_calculations (status, calculated_at DESC);

COMMENT ON TABLE public.booking_capacity_calculations IS
  'Immutable-style capacity calculator snapshots for bookings and pre-trip submissions.';

-- ---------------------------------------------------------------------------
-- capacity_calculation_overrides: admin override audit (Phase 4)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.capacity_calculation_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calculation_id uuid NOT NULL REFERENCES public.booking_capacity_calculations(id) ON DELETE CASCADE,
  original_status text NOT NULL,
  override_status text NOT NULL,
  reason text NOT NULL,
  overridden_by uuid REFERENCES public.admins(id) ON DELETE SET NULL,
  overridden_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_capacity_calculation_overrides_calculation
  ON public.capacity_calculation_overrides (calculation_id, overridden_at DESC);

-- ---------------------------------------------------------------------------
-- RLS: admin-only for all capacity tables
-- ---------------------------------------------------------------------------
ALTER TABLE public.boat_capacity_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_passengers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_capacity_calculations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.capacity_calculation_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage boat_capacity_profiles" ON public.boat_capacity_profiles;
CREATE POLICY "Admins manage boat_capacity_profiles"
  ON public.boat_capacity_profiles FOR ALL
  TO authenticated
  USING (public.lz_is_admin())
  WITH CHECK (public.lz_is_admin());

DROP POLICY IF EXISTS "Admins manage booking_passengers" ON public.booking_passengers;
CREATE POLICY "Admins manage booking_passengers"
  ON public.booking_passengers FOR ALL
  TO authenticated
  USING (public.lz_is_admin())
  WITH CHECK (public.lz_is_admin());

DROP POLICY IF EXISTS "Admins manage booking_capacity_calculations" ON public.booking_capacity_calculations;
CREATE POLICY "Admins manage booking_capacity_calculations"
  ON public.booking_capacity_calculations FOR ALL
  TO authenticated
  USING (public.lz_is_admin())
  WITH CHECK (public.lz_is_admin());

DROP POLICY IF EXISTS "Admins manage capacity_calculation_overrides" ON public.capacity_calculation_overrides;
CREATE POLICY "Admins manage capacity_calculation_overrides"
  ON public.capacity_calculation_overrides FOR ALL
  TO authenticated
  USING (public.lz_is_admin())
  WITH CHECK (public.lz_is_admin());

-- ---------------------------------------------------------------------------
-- Storage: private capacity-plate photos in documents bucket (admin only)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins upload capacity plate photos" ON storage.objects;
CREATE POLICY "Admins upload capacity plate photos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'documents'
    AND name LIKE 'capacity-plates/%'
    AND public.lz_is_admin()
  );

DROP POLICY IF EXISTS "Admins update capacity plate photos" ON storage.objects;
CREATE POLICY "Admins update capacity plate photos"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'documents'
    AND name LIKE 'capacity-plates/%'
    AND public.lz_is_admin()
  )
  WITH CHECK (
    bucket_id = 'documents'
    AND name LIKE 'capacity-plates/%'
    AND public.lz_is_admin()
  );

DROP POLICY IF EXISTS "Admins delete capacity plate photos" ON storage.objects;
CREATE POLICY "Admins delete capacity plate photos"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'documents'
    AND name LIKE 'capacity-plates/%'
    AND public.lz_is_admin()
  );

-- Admins already have SELECT on documents bucket via 20260701120000 migration.

COMMIT;

NOTIFY pgrst, 'reload schema';
