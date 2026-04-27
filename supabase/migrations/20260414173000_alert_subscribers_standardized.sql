/*
  Standardize alert subscription storage on public.alert_subscribers.
*/

CREATE TABLE IF NOT EXISTS public.alert_subscribers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  phone text,
  subscribed_to text NOT NULL CHECK (subscribed_to = ANY (ARRAY['bio'::text, 'rocket'::text])),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_notified_at timestamptz
);

ALTER TABLE public.alert_subscribers
  ADD COLUMN IF NOT EXISTS subscribed_to text;

ALTER TABLE public.alert_subscribers
  ADD COLUMN IF NOT EXISTS last_notified_at timestamptz;

UPDATE public.alert_subscribers
SET subscribed_to = 'bio'
WHERE subscribed_to IS NULL;

ALTER TABLE public.alert_subscribers
  ALTER COLUMN subscribed_to SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS alert_subscribers_email_subscribed_to_uidx
  ON public.alert_subscribers (email, subscribed_to);

CREATE INDEX IF NOT EXISTS alert_subscribers_subscribed_to_idx
  ON public.alert_subscribers (subscribed_to);

ALTER TABLE public.alert_subscribers ENABLE ROW LEVEL SECURITY;
