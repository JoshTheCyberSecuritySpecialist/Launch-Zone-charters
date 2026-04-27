/*
  Persist alert activity for admin dashboard visibility.
*/

CREATE TABLE IF NOT EXISTS public.alerts_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text,
  message text,
  score int,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS alerts_log_created_at_idx
  ON public.alerts_log (created_at DESC);

ALTER TABLE public.alerts_log ENABLE ROW LEVEL SECURITY;
