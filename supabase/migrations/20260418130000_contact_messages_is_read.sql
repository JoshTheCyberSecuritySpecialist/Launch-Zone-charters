-- Triaging: default unread; admins flip via dashboard

ALTER TABLE public.contact_messages
  ADD COLUMN IF NOT EXISTS is_read boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_contact_messages_unread
  ON public.contact_messages (is_read, created_at DESC);

CREATE POLICY "Admins can update contact messages"
  ON public.contact_messages FOR UPDATE
  TO authenticated
  USING (public.lz_is_admin())
  WITH CHECK (public.lz_is_admin());
