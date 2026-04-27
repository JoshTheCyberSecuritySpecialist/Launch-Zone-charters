-- Captain's Log: image provenance + SEO metadata (optional columns; pipeline + admin)

ALTER TABLE public.captains_log ADD COLUMN IF NOT EXISTS image_source text;
ALTER TABLE public.captains_log ADD COLUMN IF NOT EXISTS seo_keywords jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.captains_log ADD COLUMN IF NOT EXISTS image_seo_filename text;

COMMENT ON COLUMN public.captains_log.image_source IS 'SCRAPED | UNSPLASH_SEARCH | FALLBACK';
COMMENT ON COLUMN public.captains_log.seo_keywords IS 'JSON array of 3–5 SEO keywords';
COMMENT ON COLUMN public.captains_log.image_seo_filename IS 'Suggested SEO filename stem (hyphenated, no path)';
