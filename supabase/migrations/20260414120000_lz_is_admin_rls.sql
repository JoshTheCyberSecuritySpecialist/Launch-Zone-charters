-- Admin RLS: match admins by auth user id OR JWT email (admins.id is often not auth.uid()).

CREATE OR REPLACE FUNCTION public.lz_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admins a
    WHERE a.id = auth.uid()
       OR (
         a.email IS NOT NULL
         AND (auth.jwt() ->> 'email') IS NOT NULL
         AND lower(trim(a.email)) = lower(trim(auth.jwt() ->> 'email'))
       )
  );
$$;

REVOKE ALL ON FUNCTION public.lz_is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lz_is_admin() TO authenticated;

-- boats
DROP POLICY IF EXISTS "Admins can manage boats" ON boats;
CREATE POLICY "Admins can manage boats"
  ON boats FOR ALL
  TO authenticated
  USING (public.lz_is_admin())
  WITH CHECK (public.lz_is_admin());

-- customers
DROP POLICY IF EXISTS "Admins can view all customers" ON customers;
CREATE POLICY "Admins can view all customers"
  ON customers FOR SELECT
  TO authenticated
  USING (public.lz_is_admin());

-- admins (client reads this for isAdmin; must allow email-matched rows)
DROP POLICY IF EXISTS "Admins can view all admins" ON admins;
CREATE POLICY "Admins can view all admins"
  ON admins FOR SELECT
  TO authenticated
  USING (public.lz_is_admin());

-- bookings
DROP POLICY IF EXISTS "Admins can manage all bookings" ON bookings;
CREATE POLICY "Admins can manage all bookings"
  ON bookings FOR ALL
  TO authenticated
  USING (public.lz_is_admin())
  WITH CHECK (public.lz_is_admin());

-- waivers
DROP POLICY IF EXISTS "Admins can view all waivers" ON waivers;
CREATE POLICY "Admins can view all waivers"
  ON waivers FOR SELECT
  TO authenticated
  USING (public.lz_is_admin());

-- launches
DROP POLICY IF EXISTS "Admins can manage launches" ON launches;
CREATE POLICY "Admins can manage launches"
  ON launches FOR ALL
  TO authenticated
  USING (public.lz_is_admin())
  WITH CHECK (public.lz_is_admin());

-- sms_subscribers
DROP POLICY IF EXISTS "Admins can manage SMS subscribers" ON sms_subscribers;
CREATE POLICY "Admins can manage SMS subscribers"
  ON sms_subscribers FOR ALL
  TO authenticated
  USING (public.lz_is_admin())
  WITH CHECK (public.lz_is_admin());

-- blocked_dates
DROP POLICY IF EXISTS "Admins can manage blocked dates" ON blocked_dates;
CREATE POLICY "Admins can manage blocked dates"
  ON blocked_dates FOR ALL
  TO authenticated
  USING (public.lz_is_admin())
  WITH CHECK (public.lz_is_admin());

-- pricing_overrides
DROP POLICY IF EXISTS "Admins can manage pricing overrides" ON pricing_overrides;
CREATE POLICY "Admins can manage pricing overrides"
  ON pricing_overrides FOR ALL
  TO authenticated
  USING (public.lz_is_admin())
  WITH CHECK (public.lz_is_admin());

-- site_settings
DROP POLICY IF EXISTS "Admins can manage site settings" ON site_settings;
CREATE POLICY "Admins can manage site settings"
  ON site_settings FOR ALL
  TO authenticated
  USING (public.lz_is_admin())
  WITH CHECK (public.lz_is_admin());

-- captains_log
DROP POLICY IF EXISTS "Admins can manage captains log" ON captains_log;
CREATE POLICY "Admins can manage captains log"
  ON captains_log FOR ALL
  TO authenticated
  USING (public.lz_is_admin())
  WITH CHECK (public.lz_is_admin());

-- contacts
DROP POLICY IF EXISTS "Admins can manage contacts" ON contacts;
CREATE POLICY "Admins can manage contacts"
  ON contacts FOR ALL
  TO authenticated
  USING (public.lz_is_admin())
  WITH CHECK (public.lz_is_admin());

-- user_verifications
DROP POLICY IF EXISTS "Admins manage user_verifications" ON user_verifications;
CREATE POLICY "Admins manage user_verifications"
  ON user_verifications FOR ALL
  TO authenticated
  USING (public.lz_is_admin())
  WITH CHECK (public.lz_is_admin());
