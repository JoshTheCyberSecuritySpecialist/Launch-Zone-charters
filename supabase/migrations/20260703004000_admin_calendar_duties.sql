BEGIN;

ALTER TABLE public.blocked_dates
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS location text,
  ADD COLUMN IF NOT EXISTS all_day boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN public.blocked_dates.title IS
  'Admin calendar display title for blocked time such as Boat maintenance or Weather no-go.';
COMMENT ON COLUMN public.blocked_dates.location IS
  'Optional location scope for blocked time. NULL means all locations.';
COMMENT ON COLUMN public.blocked_dates.all_day IS
  'Whether the blocked time should be displayed as an all-day calendar block.';
COMMENT ON COLUMN public.blocked_dates.notes IS
  'Internal admin notes for blocked time.';

CREATE INDEX IF NOT EXISTS idx_blocked_dates_location
  ON public.blocked_dates (location);

CREATE TABLE IF NOT EXISTS public.admin_calendar_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_type text NOT NULL,
  title text NOT NULL,
  reason text,
  duty_type text,
  assigned_to text,
  boat_id uuid REFERENCES public.boats(id) ON DELETE SET NULL,
  location text,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  all_day boolean NOT NULL DEFAULT false,
  blocks_availability boolean NOT NULL DEFAULT false,
  priority text NOT NULL DEFAULT 'normal',
  notes text,
  completed boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_calendar_items_type_check CHECK (item_type IN ('blocked_time', 'admin_duty')),
  CONSTRAINT admin_calendar_items_priority_check CHECK (priority IN ('low', 'normal', 'high')),
  CONSTRAINT admin_calendar_items_time_check CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_admin_calendar_items_time
  ON public.admin_calendar_items (start_time, end_time);

CREATE INDEX IF NOT EXISTS idx_admin_calendar_items_boat_time
  ON public.admin_calendar_items (boat_id, start_time, end_time);

CREATE INDEX IF NOT EXISTS idx_admin_calendar_items_type
  ON public.admin_calendar_items (item_type);

CREATE INDEX IF NOT EXISTS idx_admin_calendar_items_completed
  ON public.admin_calendar_items (completed);

ALTER TABLE public.admin_calendar_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage admin calendar items" ON public.admin_calendar_items;
CREATE POLICY "Admins manage admin calendar items"
  ON public.admin_calendar_items FOR ALL
  TO authenticated
  USING (public.lz_is_admin())
  WITH CHECK (public.lz_is_admin());

REVOKE ALL ON public.admin_calendar_items FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_calendar_items TO authenticated;
GRANT ALL ON public.admin_calendar_items TO service_role;

COMMIT;
