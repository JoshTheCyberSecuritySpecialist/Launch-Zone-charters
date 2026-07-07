BEGIN;

CREATE TABLE IF NOT EXISTS public.stripe_disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_dispute_id text NOT NULL,
  stripe_charge_id text,
  payment_intent_id text,
  checkout_session_id text,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  shop_order_id uuid REFERENCES public.shop_orders(id) ON DELETE SET NULL,
  amount numeric(10, 2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'usd',
  reason text,
  status text NOT NULL DEFAULT 'needs_response',
  outcome text,
  evidence_due_by timestamptz,
  stripe_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stripe_disputes_stripe_dispute_id_key UNIQUE (stripe_dispute_id),
  CONSTRAINT stripe_disputes_status_check CHECK (
    status IN (
      'warning_needs_response',
      'warning_under_review',
      'warning_closed',
      'needs_response',
      'under_review',
      'charge_refunded',
      'won',
      'lost'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_stripe_disputes_booking_id
  ON public.stripe_disputes (booking_id);

CREATE INDEX IF NOT EXISTS idx_stripe_disputes_charge_id
  ON public.stripe_disputes (stripe_charge_id)
  WHERE stripe_charge_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stripe_disputes_payment_intent_id
  ON public.stripe_disputes (payment_intent_id)
  WHERE payment_intent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stripe_disputes_status_due
  ON public.stripe_disputes (status, evidence_due_by);

CREATE INDEX IF NOT EXISTS idx_stripe_disputes_created_at
  ON public.stripe_disputes (created_at DESC);

CREATE TABLE IF NOT EXISTS public.dispute_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id uuid NOT NULL REFERENCES public.stripe_disputes(id) ON DELETE CASCADE,
  admin_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  note_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dispute_notes_dispute_created
  ON public.dispute_notes (dispute_id, created_at DESC);

ALTER TABLE public.stripe_disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dispute_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage stripe_disputes" ON public.stripe_disputes;
CREATE POLICY "Admins manage stripe_disputes"
  ON public.stripe_disputes FOR ALL
  TO authenticated
  USING (public.lz_is_admin())
  WITH CHECK (public.lz_is_admin());

DROP POLICY IF EXISTS "Admins manage dispute_notes" ON public.dispute_notes;
CREATE POLICY "Admins manage dispute_notes"
  ON public.dispute_notes FOR ALL
  TO authenticated
  USING (public.lz_is_admin())
  WITH CHECK (public.lz_is_admin());

REVOKE ALL ON public.stripe_disputes FROM anon;
REVOKE ALL ON public.dispute_notes FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stripe_disputes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dispute_notes TO authenticated;
GRANT ALL ON public.stripe_disputes TO service_role;
GRANT ALL ON public.dispute_notes TO service_role;

COMMIT;
