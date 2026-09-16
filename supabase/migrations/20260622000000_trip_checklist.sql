-- Trip Checklist: centralize customer-uploaded pre-trip documents.
--
-- Government ID and Boater Safety Card proofs now live alongside the existing
-- Buoy insurance proof in user_verifications (already per-booking, anon-writable
-- for the guest upload flow, and admin-managed via RLS). This avoids loosening
-- the bookings RLS policy. bookings.license_url / license_status are kept for
-- backward compatibility and read as a fallback.

ALTER TABLE public.user_verifications
  ADD COLUMN IF NOT EXISTS id_document_url text,
  ADD COLUMN IF NOT EXISTS id_document_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS boater_card_url text,
  ADD COLUMN IF NOT EXISTS boater_card_status text NOT NULL DEFAULT 'pending';

DO $$ BEGIN
  ALTER TABLE public.user_verifications
    ADD CONSTRAINT user_verifications_id_document_status_check
    CHECK (id_document_status IN ('pending', 'submitted', 'verified', 'rejected'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.user_verifications
    ADD CONSTRAINT user_verifications_boater_card_status_check
    CHECK (boater_card_status IN ('pending', 'submitted', 'verified', 'rejected'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.user_verifications.id_document_url IS
  'Customer-uploaded government ID (Storage: licenses bucket).';
COMMENT ON COLUMN public.user_verifications.boater_card_url IS
  'Customer-uploaded boater safety education card (Storage: licenses bucket).';

-- Boater safety card requirement override.
--   NULL  => auto: required only for self-drive rentals (captain_included = false)
--   true  => admin forced required (e.g. captain-led trip that still needs it)
--   false => admin forced not required
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS boater_safety_required boolean;

COMMENT ON COLUMN public.bookings.boater_safety_required IS
  'Boater safety card override: NULL=auto (required when captain_included=false), true/false=admin forced.';
