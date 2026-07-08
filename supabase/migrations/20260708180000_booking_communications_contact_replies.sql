BEGIN;

-- Allow logging outbound emails that are not tied to a booking (e.g. contact inbox replies).
ALTER TABLE public.booking_communications
  ALTER COLUMN booking_id DROP NOT NULL;

ALTER TABLE public.booking_communications
  ADD COLUMN IF NOT EXISTS customer_message_id uuid REFERENCES public.contact_messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS customer_name text,
  ADD COLUMN IF NOT EXISTS provider text;

CREATE INDEX IF NOT EXISTS idx_booking_communications_customer_message_id
  ON public.booking_communications (customer_message_id);

CREATE INDEX IF NOT EXISTS idx_booking_communications_created_at
  ON public.booking_communications (created_at DESC);

ALTER TABLE public.booking_communications
  DROP CONSTRAINT IF EXISTS booking_communications_target_check;

ALTER TABLE public.booking_communications
  ADD CONSTRAINT booking_communications_target_check
  CHECK (booking_id IS NOT NULL OR customer_message_id IS NOT NULL);

COMMENT ON COLUMN public.booking_communications.customer_message_id IS 'Source contact_messages row when replying from the admin inbox.';
COMMENT ON COLUMN public.booking_communications.customer_name IS 'Denormalized customer name for outbox display when no booking join exists.';
COMMENT ON COLUMN public.booking_communications.provider IS 'Delivery provider such as resend or twilio.';

COMMIT;
