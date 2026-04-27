-- Allow authenticated admins to manage waivers (needed before deleting linked bookings).

DROP POLICY IF EXISTS "Admins can view all waivers" ON public.waivers;
CREATE POLICY "Admins can manage waivers"
  ON public.waivers FOR ALL
  TO authenticated
  USING (public.lz_is_admin())
  WITH CHECK (public.lz_is_admin());
