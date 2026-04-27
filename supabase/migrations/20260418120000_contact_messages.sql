-- Public contact form (browser anon key) + admin inbox (authenticated lz_is_admin)

CREATE TABLE IF NOT EXISTS public.contact_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  email text NOT NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contact_messages_created_at ON public.contact_messages (created_at DESC);

ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;

-- Site visitors submit via anon key (Vite + Supabase client)
CREATE POLICY "Public can submit contact messages"
  ON public.contact_messages FOR INSERT
  TO anon
  WITH CHECK (true);

-- Dashboard: read (and optional manage) for admins only
CREATE POLICY "Admins can read contact messages"
  ON public.contact_messages FOR SELECT
  TO authenticated
  USING (public.lz_is_admin());

CREATE POLICY "Admins can delete contact messages"
  ON public.contact_messages FOR DELETE
  TO authenticated
  USING (public.lz_is_admin());
