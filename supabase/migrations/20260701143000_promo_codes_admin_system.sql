BEGIN;

CREATE TABLE IF NOT EXISTS public.promo_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  description text,
  discount_type text NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
  discount_value numeric NOT NULL,
  max_uses integer,
  used_count integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  applies_to text NOT NULL DEFAULT 'all' CHECK (applies_to IN ('all', 'rentals', 'charters', 'groupon', 'private')),
  starts_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT promo_codes_code_upper_trim CHECK (code = upper(trim(code))),
  CONSTRAINT promo_codes_discount_value_nonnegative CHECK (discount_value >= 0),
  CONSTRAINT promo_codes_max_uses_nonnegative CHECK (max_uses IS NULL OR max_uses >= 0),
  CONSTRAINT promo_codes_used_count_nonnegative CHECK (used_count >= 0)
);

-- CREATE TABLE IF NOT EXISTS does not upgrade a pre-existing table, so make
-- this migration safe for remotes that already have an earlier promo_codes stub.
ALTER TABLE public.promo_codes
  ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS code text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS discount_type text DEFAULT 'fixed',
  ADD COLUMN IF NOT EXISTS discount_value numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_uses integer,
  ADD COLUMN IF NOT EXISTS used_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS active boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS applies_to text DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS starts_at timestamptz,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

UPDATE public.promo_codes
SET
  code = upper(trim(code)),
  discount_type = COALESCE(NULLIF(discount_type, ''), 'fixed'),
  discount_value = COALESCE(discount_value, 0),
  used_count = COALESCE(used_count, 0),
  active = COALESCE(active, true),
  applies_to = COALESCE(NULLIF(applies_to, ''), 'all'),
  created_at = COALESCE(created_at, now()),
  updated_at = COALESCE(updated_at, now());

ALTER TABLE public.promo_codes
  ALTER COLUMN id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN discount_type SET DEFAULT 'fixed',
  ALTER COLUMN discount_value SET DEFAULT 0,
  ALTER COLUMN used_count SET DEFAULT 0,
  ALTER COLUMN active SET DEFAULT true,
  ALTER COLUMN applies_to SET DEFAULT 'all',
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS promo_codes_code_unique_idx
  ON public.promo_codes (code);

COMMENT ON TABLE public.promo_codes IS 'Admin-managed booking promo codes. Customers validate codes only through the backend API.';
COMMENT ON COLUMN public.promo_codes.applies_to IS 'Booking scope: all, rentals, charters, groupon, or private.';

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS promo_code text,
  ADD COLUMN IF NOT EXISTS discount_amount numeric(10, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS original_total numeric(10, 2),
  ADD COLUMN IF NOT EXISTS final_total numeric(10, 2);

ALTER TABLE public.bookings
  ALTER COLUMN discount_amount SET DEFAULT 0;

CREATE OR REPLACE FUNCTION public.set_promo_codes_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_promo_codes_updated_at ON public.promo_codes;
CREATE TRIGGER trg_promo_codes_updated_at
  BEFORE UPDATE ON public.promo_codes
  FOR EACH ROW
  EXECUTE FUNCTION public.set_promo_codes_updated_at();

CREATE OR REPLACE FUNCTION public.increment_promo_code_usage(p_code text)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE public.promo_codes
  SET used_count = used_count + 1,
      updated_at = now()
  WHERE code = upper(trim(p_code));
$$;

REVOKE ALL ON FUNCTION public.increment_promo_code_usage(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_promo_code_usage(text) TO service_role;

ALTER TABLE public.promo_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage promo codes" ON public.promo_codes;
CREATE POLICY "Admins can manage promo codes"
  ON public.promo_codes FOR ALL
  TO authenticated
  USING (public.lz_is_admin())
  WITH CHECK (public.lz_is_admin());

REVOKE ALL ON public.promo_codes FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.promo_codes TO authenticated;
GRANT ALL ON public.promo_codes TO service_role;

INSERT INTO public.promo_codes (
  code,
  description,
  discount_type,
  discount_value,
  applies_to,
  active
)
VALUES
  ('GROUPON', 'Legacy Groupon direct-booking price match: 4hr $171, 8hr $315 for Port Orange standard pontoon rentals.', 'fixed', 0, 'groupon', true),
  ('GROUPONFUN', 'Legacy Groupon Fun direct-booking price match: 4hr $153.90, 8hr $283.50 for Port Orange standard pontoon rentals.', 'fixed', 0, 'groupon', true)
ON CONFLICT (code) DO UPDATE
SET
  description = EXCLUDED.description,
  applies_to = EXCLUDED.applies_to,
  updated_at = now();

COMMIT;
