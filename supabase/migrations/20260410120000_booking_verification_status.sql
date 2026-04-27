-- Booking verification workflow: pending_verification vs pending; per-booking doc review

ALTER TABLE customers ADD COLUMN IF NOT EXISTS insurance_proof_url text;

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE bookings
  ADD CONSTRAINT bookings_status_check CHECK (
    status IN (
      'pending',
      'pending_verification',
      'confirmed',
      'cancelled',
      'completed'
    )
  );

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS license_status text NOT NULL DEFAULT 'pending';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS insurance_status text NOT NULL DEFAULT 'pending';

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_license_status_check;
ALTER TABLE bookings
  ADD CONSTRAINT bookings_license_status_check CHECK (license_status IN ('pending', 'verified', 'rejected'));

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_insurance_status_check;
ALTER TABLE bookings
  ADD CONSTRAINT bookings_insurance_status_check CHECK (insurance_status IN ('pending', 'verified', 'rejected'));
