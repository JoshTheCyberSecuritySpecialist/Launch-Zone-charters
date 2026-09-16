-- Groupon / voucher redemption (Phase 1).
-- Customers may enter a voucher code at checkout. Validation + discounting is
-- ALWAYS server-authoritative; the frontend never supplies a discount amount.
--
-- applies_to vocabulary (matches server buildGrouponApplies):
--   'any'                      -> any booking
--   'charter_any'              -> any charter
--   'bio_tour' | 'bio_any'     -> any bioluminescence charter (default Groupon deal)
--   'rocket_any' | 'sunset_any'-> any rocket / sunset charter
--   'bio_shared' | 'bio_private' (and rocket_/sunset_ variants) -> specific variant
--   'rental'                   -> any boat rental
--
-- Single-use is the default (max_uses = 1, redeemed_booking_id holds the booking).
-- max_uses > 1 is supported via used_count; redeemed_booking_id then reflects the
-- most recent redemption.

CREATE TABLE IF NOT EXISTS public.groupon_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  status text NOT NULL DEFAULT 'active',
  discount_type text NOT NULL DEFAULT 'fixed',
  discount_amount numeric DEFAULT 0,
  applies_to text DEFAULT 'bio_tour',
  max_uses integer DEFAULT 1,
  used_count integer DEFAULT 0,
  expires_at timestamptz,
  redeemed_booking_id uuid,
  redeemed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_groupon_codes_code ON public.groupon_codes (code);

ALTER TABLE public.groupon_codes ENABLE ROW LEVEL SECURITY;
-- No policies: anon/authenticated are denied. The Node API (service role) bypasses
-- RLS, and the redemption RPCs below run SECURITY DEFINER.

-- Groupon details recorded on the booking it was applied to.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS groupon_code text,
  ADD COLUMN IF NOT EXISTS groupon_discount_amount numeric;

COMMENT ON COLUMN public.bookings.groupon_code IS
  'Normalized (UPPERCASE) Groupon/voucher code applied to this booking, if any.';
COMMENT ON COLUMN public.bookings.groupon_discount_amount IS
  'USD amount the Groupon code waived from the amount due today (server-computed).';

-- ---------------------------------------------------------------------------
-- Atomic reservation: increments used_count only when the code is still valid
-- and eligible. The row lock (FOR UPDATE) serializes concurrent reservations so
-- two customers cannot redeem the same single-use code at the same time.
-- Raises a specific message the API maps to user-friendly text.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reserve_groupon_code(p_code text, p_applies text[])
RETURNS TABLE (id uuid, discount_type text, discount_amount numeric, applies_to text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.groupon_codes;
BEGIN
  SELECT * INTO v_row
  FROM public.groupon_codes
  WHERE code = upper(btrim(p_code))
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'groupon_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_row.status <> 'active' THEN
    RAISE EXCEPTION 'groupon_inactive' USING ERRCODE = 'P0001';
  END IF;
  IF v_row.expires_at IS NOT NULL AND v_row.expires_at <= now() THEN
    RAISE EXCEPTION 'groupon_expired' USING ERRCODE = 'P0001';
  END IF;
  IF v_row.used_count >= v_row.max_uses THEN
    RAISE EXCEPTION 'groupon_used_up' USING ERRCODE = 'P0001';
  END IF;
  IF NOT (v_row.applies_to = ANY (p_applies)) THEN
    RAISE EXCEPTION 'groupon_not_eligible' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.groupon_codes
  SET used_count = used_count + 1
  WHERE public.groupon_codes.id = v_row.id;

  id := v_row.id;
  discount_type := v_row.discount_type;
  discount_amount := v_row.discount_amount;
  applies_to := v_row.applies_to;
  RETURN NEXT;
END;
$$;

-- Mark a reserved code as redeemed once the booking is created/paid.
CREATE OR REPLACE FUNCTION public.redeem_groupon_code(p_id uuid, p_booking_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.groupon_codes
  SET redeemed_booking_id = p_booking_id,
      redeemed_at = now(),
      status = CASE WHEN used_count >= max_uses THEN 'redeemed' ELSE status END
  WHERE id = p_id;
END;
$$;

-- Roll back a reservation (decrement used_count) when checkout fails before the
-- booking is finalized. Never releases a code that was already redeemed.
CREATE OR REPLACE FUNCTION public.release_groupon_code(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.groupon_codes
  SET used_count = GREATEST(used_count - 1, 0)
  WHERE id = p_id
    AND redeemed_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_groupon_code(text, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.redeem_groupon_code(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_groupon_code(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reserve_groupon_code(text, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.redeem_groupon_code(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_groupon_code(uuid) TO service_role;
