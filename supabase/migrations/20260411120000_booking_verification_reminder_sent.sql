-- One-time verification reminder email tracking (server sets after successful Resend send)

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS verification_reminder_sent_at timestamptz;
