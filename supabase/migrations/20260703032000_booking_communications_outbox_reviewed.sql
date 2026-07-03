BEGIN;

ALTER TABLE public.booking_communications
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.booking_communications
  DROP CONSTRAINT IF EXISTS booking_communications_status_check;

ALTER TABLE public.booking_communications
  ADD CONSTRAINT booking_communications_status_check
  CHECK (status IN ('pending', 'queued', 'sent', 'delivered', 'opened', 'clicked', 'failed', 'skipped'));

CREATE INDEX IF NOT EXISTS idx_booking_communications_reviewed_at
  ON public.booking_communications (reviewed_at);

COMMIT;
