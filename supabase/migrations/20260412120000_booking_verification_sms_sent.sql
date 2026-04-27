-- One-time verification SMS reminder (server sets after successful Twilio send)

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS verification_sms_sent_at timestamptz;
