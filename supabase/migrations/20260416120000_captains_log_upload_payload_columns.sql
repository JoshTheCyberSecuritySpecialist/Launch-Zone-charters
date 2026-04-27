-- Align captains_log with ai-content/upload.py insert() payload (idempotent).
-- Covers: title, slug, content, image_url, category, summary, publish_date, source

ALTER TABLE captains_log ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE captains_log ADD COLUMN IF NOT EXISTS slug text;
ALTER TABLE captains_log ADD COLUMN IF NOT EXISTS content text;
ALTER TABLE captains_log ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE captains_log ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE captains_log ADD COLUMN IF NOT EXISTS summary text;
ALTER TABLE captains_log ADD COLUMN IF NOT EXISTS publish_date timestamptz;
ALTER TABLE captains_log ADD COLUMN IF NOT EXISTS source text;
