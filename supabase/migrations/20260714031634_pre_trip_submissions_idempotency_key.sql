-- Idempotency for public pre-trip submissions (prevent duplicate rows on retry/double-click).

ALTER TABLE public.pre_trip_submissions
  ADD COLUMN IF NOT EXISTS idempotency_key uuid;

COMMENT ON COLUMN public.pre_trip_submissions.idempotency_key IS
  'Client draft UUID; unique when present so final submit can be safely retried.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_pre_trip_submissions_idempotency_key
  ON public.pre_trip_submissions (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Speeds up email+phone reuse lookups for duplicate prevention.
CREATE INDEX IF NOT EXISTS idx_pre_trip_submissions_email_created
  ON public.pre_trip_submissions (lower(trim(email)), created_at DESC);
