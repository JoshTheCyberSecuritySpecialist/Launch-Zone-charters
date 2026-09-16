-- Groupon / voucher redemption timing (Phase 1 follow-up).
--
-- WHY: A code is *reserved* (used_count incremented) the moment a customer
-- applies it at checkout, so it cannot be reused while their booking is pending.
-- But it should only be *redeemed* (redeemed_booking_id + redeemed_at stamped)
-- once staff have approved the customer's insurance / ID. Staff approval is a
-- direct client-side update of bookings.status (browser -> Supabase, no Node
-- API call), so the redemption cannot live in the server. This trigger moves
-- redemption/release to the database, keyed off the booking's status:
--
--   status -> 'confirmed' | 'completed'  => redeem the attached code
--   status -> 'cancelled'                => release the reservation (if not yet redeemed)
--
-- The trigger is SECURITY DEFINER so it can write to groupon_codes (RLS-locked,
-- no policies) even though the staff member's role normally cannot.

CREATE OR REPLACE FUNCTION public.tg_bookings_groupon_redeem()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
BEGIN
  -- Nothing to do for bookings without a reservation/Groupon code.
  IF NEW.groupon_code IS NULL OR btrim(NEW.groupon_code) = '' THEN
    RETURN NEW;
  END IF;

  -- Only react to an actual status change (or the initial insert).
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  v_code := upper(btrim(NEW.groupon_code));

  -- Staff approved (booking confirmed) or the trip is done -> redeem now.
  -- Idempotent: the redeemed_at guard means a second confirm/complete is a no-op.
  IF NEW.status IN ('confirmed', 'completed') THEN
    UPDATE public.groupon_codes
    SET redeemed_booking_id = NEW.id,
        redeemed_at = now(),
        status = CASE WHEN used_count >= max_uses THEN 'redeemed' ELSE status END
    WHERE code = v_code
      AND redeemed_at IS NULL;
    RETURN NEW;
  END IF;

  -- Booking cancelled before redemption -> hand the reservation back.
  -- A code that was already redeemed (redeemed_at set) is intentionally NOT
  -- released; a cancelled-after-approval booking keeps the code consumed.
  IF NEW.status = 'cancelled' THEN
    UPDATE public.groupon_codes
    SET used_count = GREATEST(used_count - 1, 0)
    WHERE code = v_code
      AND redeemed_at IS NULL;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bookings_groupon_redeem ON public.bookings;
CREATE TRIGGER trg_bookings_groupon_redeem
  AFTER INSERT OR UPDATE OF status ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_bookings_groupon_redeem();
