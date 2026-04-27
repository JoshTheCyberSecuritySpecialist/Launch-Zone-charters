-- Captain's Log delete from the dashboard: direct DELETE can return 0 rows when RLS
-- evaluation differs from lz_is_admin() in edge cases. This RPC runs DELETE as definer
-- after the same admin check the policies use.

CREATE OR REPLACE FUNCTION public.admin_delete_captains_log(article_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_id uuid;
BEGIN
  IF NOT public.lz_is_admin() THEN
    RAISE EXCEPTION 'not authorized'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.captains_log
  WHERE id = article_id
  RETURNING id INTO deleted_id;

  RETURN deleted_id IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_captains_log(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_captains_log(uuid) TO authenticated;
