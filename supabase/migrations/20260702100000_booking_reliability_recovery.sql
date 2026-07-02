-- Booking reliability: Stripe event ledger, payment recovery queue, activity timeline,
-- explicit PaymentIntent/Checkout Session columns, and minimal booking-draft support.

BEGIN;

-- ---------------------------------------------------------------------------
-- Explicit Stripe identifiers on bookings
-- ---------------------------------------------------------------------------

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS payment_intent_id text,
  ADD COLUMN IF NOT EXISTS checkout_session_id text,
  ADD COLUMN IF NOT EXISTS stripe_charge_id text;

COMMENT ON COLUMN public.bookings.payment_intent_id IS
  'Stripe PaymentIntent id (pi_...) used as an exactly-once payment idempotency key.';
COMMENT ON COLUMN public.bookings.checkout_session_id IS
  'Stripe Checkout Session id (cs_...) retained after finalization for reconciliation.';
COMMENT ON COLUMN public.bookings.stripe_charge_id IS
  'Stripe Charge id (ch_...) when available from the successful PaymentIntent.';

-- Backfill the new Checkout Session column from the legacy overloaded column.
UPDATE public.bookings
SET checkout_session_id = stripe_payment_id
WHERE checkout_session_id IS NULL
  AND stripe_payment_id LIKE 'cs_%';

CREATE UNIQUE INDEX IF NOT EXISTS bookings_payment_intent_id_uidx
  ON public.bookings (payment_intent_id)
  WHERE payment_intent_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS bookings_checkout_session_id_uidx
  ON public.bookings (checkout_session_id)
  WHERE checkout_session_id IS NOT NULL;

-- Make ready_for_departure block availability just like confirmed trips.
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_boat_no_time_overlap;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_boat_no_time_overlap
  EXCLUDE USING gist (
    boat_id WITH =,
    tstzrange(start_time, end_time, '[)') WITH &&
  )
  WHERE (
    status IN ('pending', 'pending_verification', 'confirmed', 'ready_for_departure', 'completed')
  );

-- Production has date-only blocked_dates in some environments. Add range
-- columns and backfill only when legacy start_date/end_date columns exist.
ALTER TABLE public.blocked_dates
  ADD COLUMN IF NOT EXISTS start_time timestamptz,
  ADD COLUMN IF NOT EXISTS end_time timestamptz;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'blocked_dates'
      AND column_name = 'start_date'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'blocked_dates'
      AND column_name = 'end_date'
  ) THEN
    EXECUTE $sql$
      UPDATE public.blocked_dates
      SET
        start_time = COALESCE(start_time, start_date::timestamptz),
        end_time = COALESCE(end_time, (end_date::date + INTERVAL '1 day')::timestamptz)
      WHERE (start_time IS NULL OR end_time IS NULL)
        AND start_date IS NOT NULL
        AND end_date IS NOT NULL
    $sql$;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_blocked_dates_time_range
  ON public.blocked_dates (start_time, end_time);

-- Remove permissive production policy drift observed during audit. Admin access
-- remains through lz_is_admin() policies from prior migrations.
DROP POLICY IF EXISTS "Allow insert bookings" ON public.bookings;
DROP POLICY IF EXISTS "Allow read bookings" ON public.bookings;
DROP POLICY IF EXISTS "Allow select bookings" ON public.bookings;
DROP POLICY IF EXISTS "Allow update bookings" ON public.bookings;
DROP POLICY IF EXISTS "public insert bookings" ON public.bookings;
DROP POLICY IF EXISTS "admin read bookings" ON public.bookings;
DROP POLICY IF EXISTS "admin update bookings" ON public.bookings;
DROP POLICY IF EXISTS "admin delete bookings" ON public.bookings;
DROP POLICY IF EXISTS "Admins can delete bookings" ON public.bookings;

DROP POLICY IF EXISTS "Allow insert customers" ON public.customers;
DROP POLICY IF EXISTS "Allow read customers" ON public.customers;
DROP POLICY IF EXISTS "Allow update customers" ON public.customers;
DROP POLICY IF EXISTS "public insert customers" ON public.customers;

DROP POLICY IF EXISTS "public insert waivers" ON public.waivers;

-- ---------------------------------------------------------------------------
-- Booking drafts: resumable customer progress and checkout state
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.booking_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resume_token text UNIQUE NOT NULL DEFAULT (
    replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
  ),
  customer_email text,
  customer_name text,
  customer_phone text,
  booking_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'started',
  checkout_session_id text UNIQUE,
  payment_intent_id text UNIQUE,
  amount_due numeric(10, 2),
  currency text NOT NULL DEFAULT 'usd',
  expires_at timestamptz,
  last_reminder_sent_at timestamptz,
  reminder_count integer NOT NULL DEFAULT 0,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_drafts_status_check CHECK (
    status IN ('started', 'checkout_created', 'paid', 'completed', 'abandoned', 'expired', 'failed')
  )
);

CREATE INDEX IF NOT EXISTS idx_booking_drafts_status_created
  ON public.booking_drafts (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_booking_drafts_customer_email
  ON public.booking_drafts (customer_email)
  WHERE customer_email IS NOT NULL;

ALTER TABLE public.booking_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage booking_drafts" ON public.booking_drafts;
CREATE POLICY "Admins manage booking_drafts"
  ON public.booking_drafts FOR ALL
  TO authenticated
  USING (public.lz_is_admin())
  WITH CHECK (public.lz_is_admin());

-- ---------------------------------------------------------------------------
-- Stripe webhook ledger
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.stripe_webhook_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  checkout_session_id text,
  payment_intent_id text,
  charge_id text,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  processing_status text NOT NULL DEFAULT 'received',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stripe_webhook_events_status_check CHECK (
    processing_status IN ('received', 'processing', 'processed', 'ignored', 'failed', 'queued')
  )
);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_status
  ON public.stripe_webhook_events (processing_status, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_checkout_session
  ON public.stripe_webhook_events (checkout_session_id)
  WHERE checkout_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_payment_intent
  ON public.stripe_webhook_events (payment_intent_id)
  WHERE payment_intent_id IS NOT NULL;

ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read stripe_webhook_events" ON public.stripe_webhook_events;
CREATE POLICY "Admins read stripe_webhook_events"
  ON public.stripe_webhook_events FOR SELECT
  TO authenticated
  USING (public.lz_is_admin());

-- ---------------------------------------------------------------------------
-- Payment recovery queue / unmatched payments
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.payment_recovery_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_intent_id text,
  checkout_session_id text,
  stripe_event_id text REFERENCES public.stripe_webhook_events(event_id) ON DELETE SET NULL,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  customer_name text,
  customer_email text,
  customer_phone text,
  boat_id uuid REFERENCES public.boats(id) ON DELETE SET NULL,
  trip_type text,
  start_time timestamptz,
  end_time timestamptz,
  amount numeric(10, 2),
  currency text NOT NULL DEFAULT 'usd',
  status text NOT NULL DEFAULT 'open',
  reason text NOT NULL DEFAULT 'booking_failed',
  error text,
  retry_count integer NOT NULL DEFAULT 0,
  next_retry_at timestamptz,
  last_retry_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_recovery_queue_status_check CHECK (
    status IN ('open', 'retrying', 'resolved', 'refunded', 'ignored')
  ),
  CONSTRAINT payment_recovery_queue_reason_check CHECK (
    reason IN ('payment_received_no_booking', 'booking_failed', 'webhook_failed', 'email_failed', 'customer_abandoned', 'refund_failed')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_recovery_queue_checkout_session_uidx
  ON public.payment_recovery_queue (checkout_session_id);

CREATE UNIQUE INDEX IF NOT EXISTS payment_recovery_queue_payment_intent_uidx
  ON public.payment_recovery_queue (payment_intent_id);

CREATE INDEX IF NOT EXISTS idx_payment_recovery_queue_status
  ON public.payment_recovery_queue (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_recovery_queue_next_retry
  ON public.payment_recovery_queue (next_retry_at)
  WHERE status IN ('open', 'retrying');

ALTER TABLE public.payment_recovery_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage payment_recovery_queue" ON public.payment_recovery_queue;
CREATE POLICY "Admins manage payment_recovery_queue"
  ON public.payment_recovery_queue FOR ALL
  TO authenticated
  USING (public.lz_is_admin())
  WITH CHECK (public.lz_is_admin());

-- ---------------------------------------------------------------------------
-- Booking payment ledger and activity timeline
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.booking_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  checkout_session_id text,
  payment_intent_id text,
  charge_id text,
  amount numeric(10, 2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'usd',
  status text NOT NULL DEFAULT 'received',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS booking_payments_checkout_session_uidx
  ON public.booking_payments (checkout_session_id);
CREATE UNIQUE INDEX IF NOT EXISTS booking_payments_payment_intent_uidx
  ON public.booking_payments (payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_booking_payments_booking
  ON public.booking_payments (booking_id, created_at DESC);

ALTER TABLE public.booking_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage booking_payments" ON public.booking_payments;
CREATE POLICY "Admins manage booking_payments"
  ON public.booking_payments FOR ALL
  TO authenticated
  USING (public.lz_is_admin())
  WITH CHECK (public.lz_is_admin());

CREATE TABLE IF NOT EXISTS public.booking_activity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid REFERENCES public.bookings(id) ON DELETE CASCADE,
  draft_id uuid REFERENCES public.booking_drafts(id) ON DELETE SET NULL,
  checkout_session_id text,
  payment_intent_id text,
  event_type text NOT NULL,
  actor_type text NOT NULL DEFAULT 'system',
  actor_id uuid,
  message text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_booking_activity_events_booking
  ON public.booking_activity_events (booking_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_booking_activity_events_checkout_session
  ON public.booking_activity_events (checkout_session_id, created_at DESC)
  WHERE checkout_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_booking_activity_events_event_type
  ON public.booking_activity_events (event_type, created_at DESC);

ALTER TABLE public.booking_activity_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read booking_activity_events" ON public.booking_activity_events;
CREATE POLICY "Admins read booking_activity_events"
  ON public.booking_activity_events FOR SELECT
  TO authenticated
  USING (public.lz_is_admin());

COMMIT;
