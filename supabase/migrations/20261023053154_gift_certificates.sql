BEGIN;

-- One row per individual bioluminescence gift ticket.
-- Purchasing does NOT consume boat capacity; redemption (later phase) does.

CREATE TABLE IF NOT EXISTS public.gift_certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gift_code text NOT NULL,
  stripe_checkout_session_id text NOT NULL,
  stripe_payment_intent_id text,
  purchaser_name text,
  purchaser_email text,
  purchaser_phone text,
  from_name text,
  recipient_name text NOT NULL,
  recipient_email text,
  gift_message text,
  package_id text NOT NULL,
  package_name text,
  guest_count integer NOT NULL DEFAULT 1,
  original_value_cents integer NOT NULL,
  amount_paid_cents integer NOT NULL,
  season_year integer NOT NULL,
  valid_from date NOT NULL,
  valid_until date NOT NULL,
  status text NOT NULL DEFAULT 'active',
  recipient_mode text NOT NULL DEFAULT 'same',
  ticket_index integer NOT NULL DEFAULT 1,
  redeemed_booking_id uuid REFERENCES public.bookings (id) ON DELETE SET NULL,
  redeemed_at timestamptz,
  confirmation_email_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gift_certificates_gift_code_unique UNIQUE (gift_code),
  CONSTRAINT gift_certificates_guest_count_positive CHECK (guest_count >= 1 AND guest_count <= 10),
  CONSTRAINT gift_certificates_cents_nonneg CHECK (
    original_value_cents >= 0 AND amount_paid_cents >= 0
  ),
  CONSTRAINT gift_certificates_season_year_range CHECK (season_year >= 2024 AND season_year <= 2100),
  CONSTRAINT gift_certificates_valid_range CHECK (valid_until >= valid_from),
  CONSTRAINT gift_certificates_status_allowed CHECK (
    status IN ('active', 'redeemed', 'cancelled', 'refunded')
  ),
  CONSTRAINT gift_certificates_recipient_mode_allowed CHECK (
    recipient_mode IN ('same', 'different')
  ),
  CONSTRAINT gift_certificates_ticket_index_positive CHECK (ticket_index >= 1),
  CONSTRAINT gift_certificates_redeemed_consistency CHECK (
    (status = 'redeemed' AND redeemed_booking_id IS NOT NULL AND redeemed_at IS NOT NULL)
    OR (status <> 'redeemed' AND redeemed_booking_id IS NULL AND redeemed_at IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS gift_certificates_session_ticket_uidx
  ON public.gift_certificates (stripe_checkout_session_id, ticket_index);

CREATE INDEX IF NOT EXISTS gift_certificates_session_idx
  ON public.gift_certificates (stripe_checkout_session_id);

CREATE INDEX IF NOT EXISTS gift_certificates_status_created_idx
  ON public.gift_certificates (status, created_at DESC);

CREATE INDEX IF NOT EXISTS gift_certificates_purchaser_email_idx
  ON public.gift_certificates (lower(purchaser_email));

CREATE INDEX IF NOT EXISTS gift_certificates_season_status_idx
  ON public.gift_certificates (season_year, status);

COMMENT ON TABLE public.gift_certificates IS
  'Bioluminescence gift tickets. Capacity is NOT reserved until redemption creates a dated booking.';

ALTER TABLE public.gift_certificates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gift_certificates_admin_all ON public.gift_certificates;
CREATE POLICY gift_certificates_admin_all ON public.gift_certificates
  FOR ALL
  USING (public.lz_is_admin())
  WITH CHECK (public.lz_is_admin());

GRANT ALL ON public.gift_certificates TO service_role;

COMMIT;
