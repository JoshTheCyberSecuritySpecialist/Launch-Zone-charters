BEGIN;

-- Admin/staff booking support fields. Existing scheduler columns
-- (booking_source, staff_created, staff_notes, external_reference) are
-- intentionally not duplicated.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS rental_location text,
  ADD COLUMN IF NOT EXISTS staff_created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS payment_note text,
  ADD COLUMN IF NOT EXISTS amount_collected numeric(10, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS manual_discount_reason text,
  ADD COLUMN IF NOT EXISTS hold_expires_at timestamptz;

COMMENT ON COLUMN public.bookings.rental_location IS
  'Staff/admin booking location label such as Port Orange, Titusville, or Daytona.';
COMMENT ON COLUMN public.bookings.staff_created_by IS
  'Auth user id for the admin/staff member who created a manual booking.';
COMMENT ON COLUMN public.bookings.payment_method IS
  'Payment method for staff/admin bookings: stripe, cash, venmo, zelle, paypal, groupon, comp, or other.';
COMMENT ON COLUMN public.bookings.payment_note IS
  'Staff/admin payment notes for non-Stripe or mixed-payment bookings.';
COMMENT ON COLUMN public.bookings.amount_collected IS
  'Amount collected outside Stripe for staff/admin bookings.';
COMMENT ON COLUMN public.bookings.manual_discount_reason IS
  'Reason a staff/admin discount or comp was applied.';
COMMENT ON COLUMN public.bookings.hold_expires_at IS
  'Expiration time for temporary phone, Groupon, or staff-created booking holds.';

-- Keep checks permissive for legacy rows and future flexibility while still
-- catching obvious invalid values on new staff/admin writes.
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_payment_method_check;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_payment_method_check CHECK (
    payment_method IS NULL
    OR payment_method IN ('stripe', 'cash', 'venmo', 'zelle', 'paypal', 'groupon', 'comp', 'other')
  );

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_amount_collected_nonnegative;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_amount_collected_nonnegative CHECK (
    amount_collected IS NULL OR amount_collected >= 0
  );

-- Add hold as a schedulable blocking status without removing existing booking
-- lifecycle states. Cancelled bookings remain non-blocking.
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_status_check CHECK (
    status IN (
      'hold',
      'pending',
      'pending_verification',
      'confirmed',
      'ready_for_departure',
      'cancelled',
      'completed'
    )
  );

-- Safe indexes for staff/admin filtering, scheduler views, and hold cleanup.
CREATE INDEX IF NOT EXISTS idx_bookings_rental_location
  ON public.bookings (rental_location);

CREATE INDEX IF NOT EXISTS idx_bookings_staff_created
  ON public.bookings (staff_created);

CREATE INDEX IF NOT EXISTS idx_bookings_booking_source
  ON public.bookings (booking_source);

CREATE INDEX IF NOT EXISTS idx_bookings_payment_method
  ON public.bookings (payment_method);

CREATE INDEX IF NOT EXISTS idx_bookings_staff_created_by
  ON public.bookings (staff_created_by);

CREATE INDEX IF NOT EXISTS idx_bookings_hold_expires_at_active_hold
  ON public.bookings (hold_expires_at)
  WHERE status = 'hold' AND hold_expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_boat_start_end
  ON public.bookings (boat_id, start_time, end_time);

-- Existing exclusion constraint is recreated with the same overlap semantics
-- plus the new hold status. The predicate intentionally excludes cancelled
-- bookings so cancelled trips never block availability.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_boat_no_time_overlap;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_boat_no_time_overlap
  EXCLUDE USING gist (
    boat_id WITH =,
    tstzrange(start_time, end_time, '[)') WITH &&
  )
  WHERE (
    status IN ('hold', 'pending', 'pending_verification', 'confirmed', 'ready_for_departure', 'completed')
  );

-- blocked_dates availability is now served by the backend, so public reads and
-- writes are not needed. Admins retain authenticated access through lz_is_admin().
ALTER TABLE public.blocked_dates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view blocked dates" ON public.blocked_dates;
DROP POLICY IF EXISTS "Admins can manage blocked dates" ON public.blocked_dates;
DROP POLICY IF EXISTS "Admins manage blocked dates" ON public.blocked_dates;

CREATE POLICY "Admins manage blocked dates"
  ON public.blocked_dates FOR ALL
  TO authenticated
  USING (public.lz_is_admin())
  WITH CHECK (public.lz_is_admin());

REVOKE ALL ON public.blocked_dates FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.blocked_dates TO authenticated;
GRANT ALL ON public.blocked_dates TO service_role;

COMMIT;
