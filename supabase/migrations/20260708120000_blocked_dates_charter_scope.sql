-- Charter-only blocks: generated captain availability must not affect boat rentals.
ALTER TABLE public.blocked_dates
  ADD COLUMN IF NOT EXISTS block_scope text NOT NULL DEFAULT 'all';

ALTER TABLE public.blocked_dates
  ADD COLUMN IF NOT EXISTS block_source text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'blocked_dates_block_scope_check'
  ) THEN
    ALTER TABLE public.blocked_dates
      ADD CONSTRAINT blocked_dates_block_scope_check
      CHECK (block_scope IN ('all', 'charter', 'rental'));
  END IF;
END $$;

COMMENT ON COLUMN public.blocked_dates.block_scope IS
  'Which booking types this block affects: all (default), charter, or rental.';
COMMENT ON COLUMN public.blocked_dates.block_source IS
  'Optional origin tag, e.g. charter_captain_availability for auto-generated charter blocks.';

CREATE INDEX IF NOT EXISTS idx_blocked_dates_block_source
  ON public.blocked_dates (block_source)
  WHERE block_source IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_blocked_dates_block_scope
  ON public.blocked_dates (block_scope);
