-- Captain's Log: manual add/delete from the Admin UI uses Supabase as the authenticated admin user.
-- Apply migrations through 20260414120000_lz_is_admin_rls.sql (or later) so policies use public.lz_is_admin().
--
-- 1) Confirm RLS policies on captains_log (expect: "Anyone can view" SELECT + admin ALL)
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'captains_log'
ORDER BY policyname;

-- 2) Confirm your signed-in user is in admins (replace with your auth user id if needed)
-- SELECT id, email FROM auth.users LIMIT 5;
-- SELECT * FROM public.admins;

-- 3) Test as admin in SQL (optional): insert then delete a row (use a unique slug)
-- INSERT INTO public.captains_log (title, slug, content, category)
-- VALUES ('Manual SQL test', 'manual-sql-test-' || floor(random() * 1e9)::text, '# Hello', 'Local Highlights');
-- DELETE FROM public.captains_log WHERE slug LIKE 'manual-sql-test-%';
