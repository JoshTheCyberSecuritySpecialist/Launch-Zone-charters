-- Public hero images for Captain's Log (admin upload from /admin).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'captains-log',
  'captains-log',
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

DROP POLICY IF EXISTS "Public read captains log bucket" ON storage.objects;
CREATE POLICY "Public read captains log bucket"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'captains-log');

DROP POLICY IF EXISTS "Admins upload captains log bucket" ON storage.objects;
CREATE POLICY "Admins upload captains log bucket"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'captains-log'
    AND public.lz_is_admin()
  );

DROP POLICY IF EXISTS "Admins update captains log bucket" ON storage.objects;
CREATE POLICY "Admins update captains log bucket"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'captains-log' AND public.lz_is_admin())
  WITH CHECK (bucket_id = 'captains-log' AND public.lz_is_admin());

DROP POLICY IF EXISTS "Admins delete captains log bucket" ON storage.objects;
CREATE POLICY "Admins delete captains log bucket"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'captains-log' AND public.lz_is_admin());
