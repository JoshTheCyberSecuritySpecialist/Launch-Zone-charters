-- SECURITY HARDENING (Phase 3 audit)
-- ---------------------------------------------------------------------------
-- DEPLOY ORDER:
--   1. Deploy updated API + frontend first (server routes replace anon DB reads/writes)
--   2. Run this migration on Supabase (SQL editor or: npm run db:push)
--   3. Complete manual dashboard steps in docs/SECURITY_HARDENING.md
--
-- Rollback: restore policies from 20260413120000_user_verifications_buoy.sql if needed.

BEGIN;

-- Idempotent confirmation email tracking (used by /api/send-booking-confirmation)
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS booking_confirmation_sent_at timestamptz;

COMMENT ON COLUMN public.bookings.booking_confirmation_sent_at IS
  'Set after customer booking confirmation email is sent; prevents replay spam.';

-- ---------------------------------------------------------------------------
-- Remove anon bulk-read of pending bookings + customers (Critical)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Anon can view pending bookings for verification" ON public.bookings;
DROP POLICY IF EXISTS "Anon can view customers with pending bookings" ON public.customers;

-- ---------------------------------------------------------------------------
-- Remove world-open user_verifications access (Critical)
-- Guest writes now go through Express API (service role).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can insert user_verifications" ON public.user_verifications;
DROP POLICY IF EXISTS "Anyone can update user_verifications" ON public.user_verifications;
DROP POLICY IF EXISTS "Anyone can select user_verifications" ON public.user_verifications;

-- Admins retain full access via lz_is_admin() (reassert policy name from lz migration)
DROP POLICY IF EXISTS "Admins manage user_verifications" ON public.user_verifications;
CREATE POLICY "Admins manage user_verifications"
  ON public.user_verifications FOR ALL
  TO authenticated
  USING (public.lz_is_admin())
  WITH CHECK (public.lz_is_admin());

-- ---------------------------------------------------------------------------
-- Drop legacy permissive INSERT policies (Medium)
-- Checkout + API use service role for inserts.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can create customer records" ON public.customers;
DROP POLICY IF EXISTS "Anyone can create bookings" ON public.bookings;
DROP POLICY IF EXISTS "Anyone can create waivers" ON public.waivers;

-- ---------------------------------------------------------------------------
-- Storage: make sensitive buckets private; admin-only read
-- Uploads: service role signed URLs from API (no anon INSERT on whole bucket)
-- Manual pre-trip path: scoped anon INSERT for pre-trip/* only (temporary)
-- ---------------------------------------------------------------------------

UPDATE storage.buckets SET public = false WHERE id IN ('licenses', 'documents');

DROP POLICY IF EXISTS "Public read licenses bucket" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can upload to licenses bucket" ON storage.objects;
DROP POLICY IF EXISTS "Public read documents bucket" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can upload documents bucket" ON storage.objects;

DROP POLICY IF EXISTS "Admins read licenses bucket" ON storage.objects;
CREATE POLICY "Admins read licenses bucket"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'licenses' AND public.lz_is_admin());

DROP POLICY IF EXISTS "Admins read documents bucket" ON storage.objects;
CREATE POLICY "Admins read documents bucket"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'documents' AND public.lz_is_admin());

-- Off-platform manual submissions (pre-trip/* paths) until fully server-side
DROP POLICY IF EXISTS "Anon upload pre-trip documents" ON storage.objects;
CREATE POLICY "Anon upload pre-trip documents"
  ON storage.objects FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    bucket_id = 'documents'
    AND (
      name LIKE 'licenses/pre-trip/%'
      OR name LIKE 'insurance/pre-trip/%'
    )
  );

-- incident-photos bucket (referenced in Admin UI)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'incident-photos',
  'incident-photos',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]
)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS "Admins manage incident photos" ON storage.objects;
CREATE POLICY "Admins manage incident photos"
  ON storage.objects FOR ALL
  TO authenticated
  USING (bucket_id = 'incident-photos' AND public.lz_is_admin())
  WITH CHECK (bucket_id = 'incident-photos' AND public.lz_is_admin());

COMMIT;

-- ---------------------------------------------------------------------------
-- MANUAL (Supabase Dashboard) — not expressible as SQL:
--   • Authentication → disable public sign-up (invite-only admins)
--   • Ensure public.admins.id = auth.users.id for each admin (not email-only)
--   • Rotate CRON_SECRET if it was ever used in query strings
--   • Set FRONTEND_URL / APP_PUBLIC_URL / CORS_ORIGIN in production API env
-- ---------------------------------------------------------------------------
