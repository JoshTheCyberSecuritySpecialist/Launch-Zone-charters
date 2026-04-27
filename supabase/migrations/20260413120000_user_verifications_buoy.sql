-- Buoy insurance proof + review (per booking). Storage bucket: licenses.

CREATE TABLE IF NOT EXISTS user_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  buoy_status text NOT NULL DEFAULT 'pending'
    CHECK (buoy_status IN ('pending', 'verified', 'rejected')),
  buoy_proof_url text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT user_verifications_booking_id_key UNIQUE (booking_id)
);

CREATE INDEX IF NOT EXISTS idx_user_verifications_booking_id ON user_verifications(booking_id);

ALTER TABLE user_verifications ENABLE ROW LEVEL SECURITY;

-- Guest verify flow (link + booking UUID); same coarse model as "Anyone can create bookings"
DROP POLICY IF EXISTS "Anyone can insert user_verifications" ON user_verifications;
CREATE POLICY "Anyone can insert user_verifications"
  ON user_verifications FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can update user_verifications" ON user_verifications;
CREATE POLICY "Anyone can update user_verifications"
  ON user_verifications FOR UPDATE
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can select user_verifications" ON user_verifications;
CREATE POLICY "Anyone can select user_verifications"
  ON user_verifications FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Admins manage user_verifications" ON user_verifications;
CREATE POLICY "Admins manage user_verifications"
  ON user_verifications FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid()));

-- Allow unauthenticated clients to load a pending booking for /verify?bookingId=
DROP POLICY IF EXISTS "Anon can view pending bookings for verification" ON bookings;
CREATE POLICY "Anon can view pending bookings for verification"
  ON bookings FOR SELECT
  TO anon
  USING (status IN ('pending', 'pending_verification'));

DROP POLICY IF EXISTS "Anon can view customers with pending bookings" ON customers;
CREATE POLICY "Anon can view customers with pending bookings"
  ON customers FOR SELECT
  TO anon
  USING (
    EXISTS (
      SELECT 1
      FROM bookings b
      WHERE b.customer_id = customers.id
        AND b.status IN ('pending', 'pending_verification')
    )
  );

-- Storage: proof uploads (images + PDF)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'licenses',
  'licenses',
  true,
  5242880,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/pdf'
  ]::text[]
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public read licenses bucket" ON storage.objects;
CREATE POLICY "Public read licenses bucket"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'licenses');

DROP POLICY IF EXISTS "Anyone can upload to licenses bucket" ON storage.objects;
CREATE POLICY "Anyone can upload to licenses bucket"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'licenses');
