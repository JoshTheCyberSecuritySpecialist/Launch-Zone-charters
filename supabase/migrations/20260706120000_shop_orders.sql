BEGIN;

CREATE TABLE IF NOT EXISTS public.shop_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_session_id text UNIQUE NOT NULL,
  payment_intent_id text,
  stripe_charge_id text,
  customer_name text,
  email text,
  phone text,
  quantity integer NOT NULL DEFAULT 1,
  shipping_name text,
  shipping_address jsonb,
  amount_paid numeric(10, 2),
  currency text NOT NULL DEFAULT 'usd',
  status text NOT NULL DEFAULT 'pending',
  product_slug text NOT NULL DEFAULT 'observation-bottle',
  confirmation_email_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shop_orders_quantity_range CHECK (quantity >= 1 AND quantity <= 10),
  CONSTRAINT shop_orders_status_allowed CHECK (
    status IN (
      'pending',
      'paid',
      'processing',
      'shipped',
      'delivered',
      'refunded',
      'cancelled'
    )
  )
);

CREATE INDEX IF NOT EXISTS shop_orders_status_created_idx
  ON public.shop_orders (status, created_at DESC);

CREATE INDEX IF NOT EXISTS shop_orders_email_idx
  ON public.shop_orders (lower(email));

ALTER TABLE public.shop_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shop_orders_admin_all ON public.shop_orders;
CREATE POLICY shop_orders_admin_all ON public.shop_orders
  FOR ALL
  USING (public.lz_is_admin())
  WITH CHECK (public.lz_is_admin());

COMMIT;
