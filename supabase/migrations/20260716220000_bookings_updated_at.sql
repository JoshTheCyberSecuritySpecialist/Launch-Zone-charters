-- Align production bookings with core schema: boats/customers/bookings all track updated_at.
-- Initial schema defined this column; some environments were created without it.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.bookings
SET updated_at = COALESCE(created_at, now())
WHERE updated_at IS NULL;

CREATE OR REPLACE FUNCTION public.set_bookings_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bookings_updated_at ON public.bookings;
CREATE TRIGGER trg_bookings_updated_at
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_bookings_updated_at();

COMMENT ON COLUMN public.bookings.updated_at IS
  'Last modification time; maintained by trg_bookings_updated_at on UPDATE.';

NOTIFY pgrst, 'reload schema';
