BEGIN;

-- Phase 1: Groupon voucher import, deal-option mapping, and voucher lifecycle tracking.
-- Does not create a second booking table; vouchers link to existing bookings when booked.

CREATE TABLE IF NOT EXISTS public.groupon_deal_option_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_name text NOT NULL,
  deal_name_normalized text NOT NULL,
  option_name text NOT NULL,
  option_name_normalized text NOT NULL,
  deal_permalink text,
  booking_type text NOT NULL CHECK (booking_type IN ('rental', 'charter')),
  charter_type text CHECK (charter_type IS NULL OR charter_type IN ('bio', 'rocket', 'sunset', 'captain_charter')),
  rental_type text CHECK (rental_type IS NULL OR rental_type IN ('half_day', 'full_day', 'hourly')),
  rental_location text,
  covered_guest_count integer NOT NULL DEFAULT 1 CHECK (covered_guest_count >= 1),
  service_label text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT groupon_deal_option_mappings_unique_deal_option
    UNIQUE (deal_name_normalized, option_name_normalized)
);

COMMENT ON TABLE public.groupon_deal_option_mappings IS
  'Maps imported Groupon deal + option names to internal booking service identifiers.';

CREATE TABLE IF NOT EXISTS public.groupon_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename text,
  uploaded_by uuid,
  status text NOT NULL DEFAULT 'preview'
    CHECK (status IN ('preview', 'confirmed', 'failed')),
  row_count integer NOT NULL DEFAULT 0,
  inserted_count integer NOT NULL DEFAULT 0,
  updated_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  duplicate_in_file_count integer NOT NULL DEFAULT 0,
  unmapped_count integer NOT NULL DEFAULT 0,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz
);

COMMENT ON TABLE public.groupon_import_batches IS
  'Admin Groupon CSV import batches with preview/confirm workflow.';

CREATE TABLE IF NOT EXISTS public.groupon_vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_hash text NOT NULL UNIQUE,
  voucher_last_four text NOT NULL,
  owner_name text,
  owner_name_normalized text,
  merchant_reference_id text,
  purchased_at timestamptz,
  expires_at timestamptz,
  source_status text,
  payable_event text,
  redeemed_flag text,
  redeemed_at timestamptz,
  redeemed_by text,
  refunded_at timestamptz,
  refund_reason text,
  deal_name text,
  deal_permalink text,
  option_name text,
  divisions text,
  cda text,
  groupon_price_cents integer,
  sell_price_cents integer,
  local_status text NOT NULL DEFAULT 'available'
    CHECK (local_status IN (
      'available', 'reserved', 'booked', 'used', 'expired', 'cancelled', 'review_required'
    )),
  mapping_id uuid REFERENCES public.groupon_deal_option_mappings (id) ON DELETE SET NULL,
  booking_id uuid REFERENCES public.bookings (id) ON DELETE SET NULL,
  import_batch_id uuid REFERENCES public.groupon_import_batches (id) ON DELETE SET NULL,
  last_import_batch_id uuid REFERENCES public.groupon_import_batches (id) ON DELETE SET NULL,
  admin_notes text,
  reserved_until timestamptz,
  reserved_session_token text,
  review_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.groupon_vouchers IS
  'Imported Groupon vouchers keyed by HMAC hash; full voucher numbers are never stored.';
COMMENT ON COLUMN public.groupon_vouchers.voucher_hash IS
  'HMAC-SHA256 of normalized voucher number for exact lookup without storing the raw code.';
COMMENT ON COLUMN public.groupon_vouchers.voucher_last_four IS
  'Last four characters of normalized voucher number for masked admin display.';

CREATE TABLE IF NOT EXISTS public.groupon_voucher_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id uuid NOT NULL REFERENCES public.groupon_vouchers (id) ON DELETE CASCADE,
  event_type text NOT NULL,
  actor_type text NOT NULL DEFAULT 'system' CHECK (actor_type IN ('system', 'admin')),
  actor_id uuid,
  message text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.groupon_voucher_events IS
  'Audit trail for Groupon voucher import and lifecycle changes.';

CREATE INDEX IF NOT EXISTS idx_groupon_vouchers_local_status
  ON public.groupon_vouchers (local_status);

CREATE INDEX IF NOT EXISTS idx_groupon_vouchers_expires_at
  ON public.groupon_vouchers (expires_at);

CREATE INDEX IF NOT EXISTS idx_groupon_vouchers_booking_id
  ON public.groupon_vouchers (booking_id)
  WHERE booking_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_groupon_vouchers_mapping_id
  ON public.groupon_vouchers (mapping_id);

CREATE INDEX IF NOT EXISTS idx_groupon_vouchers_last_four
  ON public.groupon_vouchers (voucher_last_four);

CREATE INDEX IF NOT EXISTS idx_groupon_vouchers_merchant_reference_id
  ON public.groupon_vouchers (merchant_reference_id)
  WHERE merchant_reference_id IS NOT NULL AND merchant_reference_id <> '';

CREATE INDEX IF NOT EXISTS idx_groupon_voucher_events_voucher_id
  ON public.groupon_voucher_events (voucher_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_groupon_import_batches_created_at
  ON public.groupon_import_batches (created_at DESC);

CREATE OR REPLACE FUNCTION public.set_groupon_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_groupon_deal_option_mappings_updated_at ON public.groupon_deal_option_mappings;
CREATE TRIGGER trg_groupon_deal_option_mappings_updated_at
  BEFORE UPDATE ON public.groupon_deal_option_mappings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_groupon_updated_at();

DROP TRIGGER IF EXISTS trg_groupon_vouchers_updated_at ON public.groupon_vouchers;
CREATE TRIGGER trg_groupon_vouchers_updated_at
  BEFORE UPDATE ON public.groupon_vouchers
  FOR EACH ROW
  EXECUTE FUNCTION public.set_groupon_updated_at();

ALTER TABLE public.groupon_deal_option_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groupon_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groupon_vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groupon_voucher_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage groupon deal option mappings" ON public.groupon_deal_option_mappings;
CREATE POLICY "Admins manage groupon deal option mappings"
  ON public.groupon_deal_option_mappings FOR ALL
  TO authenticated
  USING (public.lz_is_admin())
  WITH CHECK (public.lz_is_admin());

DROP POLICY IF EXISTS "Admins manage groupon import batches" ON public.groupon_import_batches;
CREATE POLICY "Admins manage groupon import batches"
  ON public.groupon_import_batches FOR ALL
  TO authenticated
  USING (public.lz_is_admin())
  WITH CHECK (public.lz_is_admin());

DROP POLICY IF EXISTS "Admins manage groupon vouchers" ON public.groupon_vouchers;
CREATE POLICY "Admins manage groupon vouchers"
  ON public.groupon_vouchers FOR ALL
  TO authenticated
  USING (public.lz_is_admin())
  WITH CHECK (public.lz_is_admin());

DROP POLICY IF EXISTS "Admins manage groupon voucher events" ON public.groupon_voucher_events;
CREATE POLICY "Admins manage groupon voucher events"
  ON public.groupon_voucher_events FOR ALL
  TO authenticated
  USING (public.lz_is_admin())
  WITH CHECK (public.lz_is_admin());

REVOKE ALL ON public.groupon_deal_option_mappings FROM anon;
REVOKE ALL ON public.groupon_import_batches FROM anon;
REVOKE ALL ON public.groupon_vouchers FROM anon;
REVOKE ALL ON public.groupon_voucher_events FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.groupon_deal_option_mappings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.groupon_import_batches TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.groupon_vouchers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.groupon_voucher_events TO authenticated;

GRANT ALL ON public.groupon_deal_option_mappings TO service_role;
GRANT ALL ON public.groupon_import_batches TO service_role;
GRANT ALL ON public.groupon_vouchers TO service_role;
GRANT ALL ON public.groupon_voucher_events TO service_role;

-- Seed mappings derived from the production export structure (sanitized labels).
INSERT INTO public.groupon_deal_option_mappings (
  deal_name,
  deal_name_normalized,
  option_name,
  option_name_normalized,
  deal_permalink,
  booking_type,
  charter_type,
  rental_type,
  rental_location,
  covered_guest_count,
  service_label
)
VALUES
  (
    'Captain-Led Bioluminescence Night Tour with Launch Zone Charters',
    'captain-led bioluminescence night tour with launch zone charters',
    'Bioluminescence Night Tour for One Person',
    'bioluminescence night tour for one person',
    'launch-zone-charters',
    'charter',
    'bio',
    NULL,
    NULL,
    1,
    'Bioluminescence Night Tour — 1 guest'
  ),
  (
    'Captain-Led Bioluminescence Night Tour with Launch Zone Charters',
    'captain-led bioluminescence night tour with launch zone charters',
    'Bioluminescence Night Tour for 2 People',
    'bioluminescence night tour for 2 people',
    'launch-zone-charters',
    'charter',
    'bio',
    NULL,
    NULL,
    2,
    'Bioluminescence Night Tour — 2 guests'
  ),
  (
    'Captain-Led Bioluminescence Night Tour with Launch Zone Charters',
    'captain-led bioluminescence night tour with launch zone charters',
    'Bioluminescence Night Tour for 4 People',
    'bioluminescence night tour for 4 people',
    'launch-zone-charters',
    'charter',
    'bio',
    NULL,
    NULL,
    4,
    'Bioluminescence Night Tour — 4 guests'
  ),
  (
    'Port Orange Pontoon Rental for up to 6: Explore Sandbars & Disappearing Island (Up to 20% Off)',
    'port orange pontoon rental for up to 6: explore sandbars & disappearing island (up to 20% off)',
    '4-Hour Port Orange Sandbar Pontoon Boat Rental (Up to 6 Passengers)',
    '4-hour port orange sandbar pontoon boat rental (up to 6 passengers)',
    'launch-zone-charters-3',
    'rental',
    NULL,
    'half_day',
    'port-orange',
    6,
    'Port Orange 4-hour pontoon rental — up to 6 guests'
  ),
  (
    'Port Orange Pontoon Rental for up to 6: Explore Sandbars & Disappearing Island (Up to 20% Off)',
    'port orange pontoon rental for up to 6: explore sandbars & disappearing island (up to 20% off)',
    'Full-Day 8-hour Port Orange Pontoon Boat Rental (Up to 6 Passengers)',
    'full-day 8-hour port orange pontoon boat rental (up to 6 passengers)',
    'launch-zone-charters-3',
    'rental',
    NULL,
    'full_day',
    'port-orange',
    6,
    'Port Orange 8-hour pontoon rental — up to 6 guests'
  )
ON CONFLICT (deal_name_normalized, option_name_normalized) DO UPDATE
SET
  deal_name = EXCLUDED.deal_name,
  option_name = EXCLUDED.option_name,
  deal_permalink = EXCLUDED.deal_permalink,
  booking_type = EXCLUDED.booking_type,
  charter_type = EXCLUDED.charter_type,
  rental_type = EXCLUDED.rental_type,
  rental_location = EXCLUDED.rental_location,
  covered_guest_count = EXCLUDED.covered_guest_count,
  service_label = EXCLUDED.service_label,
  active = true,
  updated_at = now();

COMMIT;
