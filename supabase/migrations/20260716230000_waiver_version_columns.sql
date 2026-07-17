-- Store waiver version metadata with each signed waiver record for legal evidence.

ALTER TABLE public.waivers
  ADD COLUMN IF NOT EXISTS waiver_version text,
  ADD COLUMN IF NOT EXISTS waiver_version_effective_at timestamptz;

COMMENT ON COLUMN public.waivers.waiver_version IS
  'Version label of the waiver text accepted by the customer (e.g. 1.0).';
COMMENT ON COLUMN public.waivers.waiver_version_effective_at IS
  'When this waiver version became active.';

NOTIFY pgrst, 'reload schema';
