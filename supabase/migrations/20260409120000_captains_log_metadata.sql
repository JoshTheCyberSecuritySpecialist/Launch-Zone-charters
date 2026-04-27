-- Article metadata from scraper (summary, original publish time, source domain)

ALTER TABLE captains_log ADD COLUMN IF NOT EXISTS summary text;
ALTER TABLE captains_log ADD COLUMN IF NOT EXISTS publish_date timestamptz;
ALTER TABLE captains_log ADD COLUMN IF NOT EXISTS source text;
