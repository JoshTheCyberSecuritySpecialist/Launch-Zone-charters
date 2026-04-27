-- Booking-level document URLs (in addition to customers.id_document_url / insurance_proof_url).
-- Public bucket so admin "View" links work without signed-URL plumbing; tighten later if needed.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS license_url text;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS insurance_url text;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'documents',
  'documents',
  true,
  10485760,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/pdf'
  ]::text[]
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public read documents bucket" ON storage.objects;
CREATE POLICY "Public read documents bucket"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'documents');

DROP POLICY IF EXISTS "Anyone can upload documents bucket" ON storage.objects;
CREATE POLICY "Anyone can upload documents bucket"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'documents');
