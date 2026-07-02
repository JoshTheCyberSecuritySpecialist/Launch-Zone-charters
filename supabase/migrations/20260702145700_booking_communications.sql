BEGIN;

CREATE TABLE IF NOT EXISTS public.booking_communications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  channel text NOT NULL,
  message_type text NOT NULL,
  recipient text NOT NULL,
  subject text,
  body text NOT NULL,
  sent_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sent_at timestamptz,
  status text NOT NULL DEFAULT 'pending',
  provider_message_id text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_communications_channel_check CHECK (channel IN ('email', 'sms')),
  CONSTRAINT booking_communications_status_check CHECK (status IN ('pending', 'sent', 'failed', 'skipped'))
);

CREATE INDEX IF NOT EXISTS idx_booking_communications_booking_created
  ON public.booking_communications (booking_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_booking_communications_message_type
  ON public.booking_communications (message_type);

CREATE INDEX IF NOT EXISTS idx_booking_communications_sent_by
  ON public.booking_communications (sent_by);

ALTER TABLE public.booking_communications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage booking communications" ON public.booking_communications;
CREATE POLICY "Admins manage booking communications"
  ON public.booking_communications FOR ALL
  TO authenticated
  USING (public.lz_is_admin())
  WITH CHECK (public.lz_is_admin());

REVOKE ALL ON public.booking_communications FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.booking_communications TO authenticated;
GRANT ALL ON public.booking_communications TO service_role;

COMMIT;
