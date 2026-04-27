-- Resolve Captain's Log article when the URL slug does not exactly match captains_log.slug
-- (e.g. bookmark from an old client, manual URL, or minor slug drift). Public read only; RLS unchanged.

CREATE OR REPLACE FUNCTION public.resolve_captains_log_slug(p text)
RETURNS public.captains_log
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT *
  FROM public.captains_log
  WHERE NULLIF(trim(p), '') IS NOT NULL
    AND (
      slug = trim(p)
      OR (
        length(trim(p)) >= 24
        AND (
          (char_length(slug) <= char_length(trim(p)) AND trim(p) LIKE slug || '%')
          OR (char_length(trim(p)) < char_length(slug) AND slug LIKE trim(p) || '%')
        )
      )
    )
  ORDER BY (slug = trim(p)) DESC, char_length(slug) DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.resolve_captains_log_slug(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_captains_log_slug(text) TO anon;
GRANT EXECUTE ON FUNCTION public.resolve_captains_log_slug(text) TO authenticated;
