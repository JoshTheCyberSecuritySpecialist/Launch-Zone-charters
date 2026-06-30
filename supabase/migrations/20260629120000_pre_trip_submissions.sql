-- Off-platform pre-trip document submissions (Groupon, phone, etc.) — matched to bookings by admin.

CREATE TABLE IF NOT EXISTS public.pre_trip_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matched_booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  customer_name text,
  email text NOT NULL,
  phone text,
  trip_type text NOT NULL CHECK (
    trip_type IN ('pontoon_rental', 'center_console_rental', 'captain_charter')
  ),
  selected_boat_reg_no text,
  groupon_code text,
  requested_trip_date timestamptz,
  waiver_signed boolean NOT NULL DEFAULT false,
  waiver_signed_at timestamptz,
  waiver_signature text,
  license_url text,
  insurance_url text,
  license_status text NOT NULL DEFAULT 'pending',
  insurance_status text NOT NULL DEFAULT 'pending',
  admin_status text NOT NULL DEFAULT 'pending' CHECK (
    admin_status IN ('pending', 'matched', 'approved', 'rejected')
  ),
  admin_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pre_trip_submissions
  DROP CONSTRAINT IF EXISTS pre_trip_submissions_license_status_check;
ALTER TABLE public.pre_trip_submissions
  ADD CONSTRAINT pre_trip_submissions_license_status_check CHECK (
    license_status IN ('pending', 'verified', 'rejected')
  );

ALTER TABLE public.pre_trip_submissions
  DROP CONSTRAINT IF EXISTS pre_trip_submissions_insurance_status_check;
ALTER TABLE public.pre_trip_submissions
  ADD CONSTRAINT pre_trip_submissions_insurance_status_check CHECK (
    insurance_status IN ('pending', 'submitted', 'verified', 'rejected')
  );

CREATE INDEX IF NOT EXISTS idx_pre_trip_submissions_email
  ON public.pre_trip_submissions (lower(trim(email)));

CREATE INDEX IF NOT EXISTS idx_pre_trip_submissions_admin_status
  ON public.pre_trip_submissions (admin_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pre_trip_submissions_matched_booking
  ON public.pre_trip_submissions (matched_booking_id)
  WHERE matched_booking_id IS NOT NULL;

ALTER TABLE public.pre_trip_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anon can insert pre_trip_submissions" ON public.pre_trip_submissions;
CREATE POLICY "Anon can insert pre_trip_submissions"
  ON public.pre_trip_submissions FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Admins manage pre_trip_submissions" ON public.pre_trip_submissions;
CREATE POLICY "Admins manage pre_trip_submissions"
  ON public.pre_trip_submissions FOR ALL
  TO authenticated
  USING (public.lz_is_admin())
  WITH CHECK (public.lz_is_admin());

COMMENT ON TABLE public.pre_trip_submissions IS
  'Off-platform customer waiver/insurance submissions; staff matches to bookings in admin.';
