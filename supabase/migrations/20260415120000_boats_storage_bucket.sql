-- Public bucket for boat listing images (admin upload from /admin/boats).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'boats',
  'boats',
  true,
  10485760,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif'
  ]::text[]
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public read boats bucket" ON storage.objects;
CREATE POLICY "Public read boats bucket"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'boats');

DROP POLICY IF EXISTS "Admins upload boats bucket" ON storage.objects;
CREATE POLICY "Admins upload boats bucket"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'boats'
    AND EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid())
  );

DROP POLICY IF EXISTS "Admins update boats bucket" ON storage.objects;
CREATE POLICY "Admins update boats bucket"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'boats'
    AND EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid())
  )
  WITH CHECK (
    bucket_id = 'boats'
    AND EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid())
  );

DROP POLICY IF EXISTS "Admins delete boats bucket" ON storage.objects;
CREATE POLICY "Admins delete boats bucket"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'boats'
    AND EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid())
  );
