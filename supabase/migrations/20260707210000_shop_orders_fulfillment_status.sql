BEGIN;

ALTER TABLE public.shop_orders
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS fulfilled_at timestamptz,
  ADD COLUMN IF NOT EXISTS canceled_at timestamptz,
  ADD COLUMN IF NOT EXISTS abandoned_at timestamptz,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.shop_orders DROP CONSTRAINT IF EXISTS shop_orders_status_allowed;

ALTER TABLE public.shop_orders ADD CONSTRAINT shop_orders_status_allowed CHECK (
  status IN (
    'incomplete',
    'pending',
    'abandoned',
    'paid',
    'processing',
    'shipped',
    'delivered',
    'refunded',
    'cancelled'
  )
);

CREATE INDEX IF NOT EXISTS shop_orders_paid_at_idx
  ON public.shop_orders (paid_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS shop_orders_stripe_session_idx
  ON public.shop_orders (stripe_session_id);

-- Legacy pending rows with no payment evidence are abandoned checkouts, not real orders.
UPDATE public.shop_orders
SET
  status = 'abandoned',
  abandoned_at = COALESCE(abandoned_at, updated_at, created_at),
  updated_at = now()
WHERE status IN ('pending', 'incomplete')
  AND payment_intent_id IS NULL
  AND (amount_paid IS NULL OR amount_paid = 0)
  AND stripe_session_id IS NOT NULL;

-- Rows that were cancelled on Stripe expiry but never paid → abandoned for clarity.
UPDATE public.shop_orders
SET
  status = 'abandoned',
  abandoned_at = COALESCE(abandoned_at, canceled_at, updated_at, created_at),
  updated_at = now()
WHERE status = 'cancelled'
  AND payment_intent_id IS NULL
  AND (amount_paid IS NULL OR amount_paid = 0);

COMMIT;
