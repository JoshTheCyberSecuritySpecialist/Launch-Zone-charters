-- Audit trail for admin approve/reject on off-platform pre-trip submissions.

ALTER TABLE public.pre_trip_submissions
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

COMMENT ON COLUMN public.pre_trip_submissions.reviewed_by IS
  'Admin user who last approved or rejected this submission.';
COMMENT ON COLUMN public.pre_trip_submissions.reviewed_at IS
  'When the submission was last approved or rejected.';
COMMENT ON COLUMN public.pre_trip_submissions.rejection_reason IS
  'Required admin note when admin_status is rejected.';
