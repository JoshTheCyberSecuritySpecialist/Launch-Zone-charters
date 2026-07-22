-- Allow waiver passenger snapshots without an assigned boat (745 lb guest-weight flow).
BEGIN;

ALTER TABLE public.booking_capacity_calculations
  ALTER COLUMN boat_id DROP NOT NULL;

COMMENT ON COLUMN public.booking_capacity_calculations.boat_id IS
  'Optional assigned boat. Waiver passenger snapshots may be saved before boat assignment.';

COMMIT;
