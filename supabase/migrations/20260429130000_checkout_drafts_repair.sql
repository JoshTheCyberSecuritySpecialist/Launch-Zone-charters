-- Repair migration: ensure checkout_drafts exists even if prior migration history drifted.

CREATE TABLE IF NOT EXISTS public.checkout_drafts (
  stripe_session_id text PRIMARY KEY,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_checkout_drafts_created_at
  ON public.checkout_drafts (created_at DESC);

ALTER TABLE public.checkout_drafts ENABLE ROW LEVEL SECURITY;
