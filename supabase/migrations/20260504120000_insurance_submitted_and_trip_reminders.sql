-- Allow "submitted" (proof uploaded, awaiting admin) for rental insurance workflow.
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_insurance_status_check;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_insurance_status_check CHECK (
    insurance_status IN ('pending', 'submitted', 'verified', 'rejected')
  );

-- Trip-relative insurance reminders (email + SMS); one shot each per booking.
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS insurance_reminder_24h_sent_at timestamptz;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS insurance_reminder_2h_sent_at timestamptz;

COMMENT ON COLUMN public.bookings.insurance_reminder_24h_sent_at IS
  'When we sent the ~24h-before-trip rental insurance reminder (email/SMS).';
COMMENT ON COLUMN public.bookings.insurance_reminder_2h_sent_at IS
  'When we sent the ~2h-before-trip rental insurance reminder (email/SMS).';
