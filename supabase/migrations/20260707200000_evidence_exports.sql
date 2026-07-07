BEGIN;

CREATE TABLE IF NOT EXISTS public.evidence_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id uuid REFERENCES public.stripe_disputes(id) ON DELETE SET NULL,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  admin_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  format text NOT NULL,
  stripe_submitted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evidence_exports_format_check CHECK (format IN ('pdf', 'zip', 'stripe_submit'))
);

CREATE INDEX IF NOT EXISTS idx_evidence_exports_dispute_created
  ON public.evidence_exports (dispute_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_evidence_exports_booking_created
  ON public.evidence_exports (booking_id, created_at DESC);

ALTER TABLE public.evidence_exports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage evidence_exports" ON public.evidence_exports;
CREATE POLICY "Admins manage evidence_exports"
  ON public.evidence_exports FOR ALL
  TO authenticated
  USING (public.lz_is_admin())
  WITH CHECK (public.lz_is_admin());

REVOKE ALL ON public.evidence_exports FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.evidence_exports TO authenticated;
GRANT ALL ON public.evidence_exports TO service_role;

COMMIT;
