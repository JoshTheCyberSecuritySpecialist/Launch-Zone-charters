-- Original article URL for "Read full article" links (distinct from `source` hostname)

ALTER TABLE captains_log ADD COLUMN IF NOT EXISTS source_url text;
