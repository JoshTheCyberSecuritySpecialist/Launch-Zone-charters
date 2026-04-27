-- SEO / accessibility: hero image alt text (pipeline sets per insert)
ALTER TABLE captains_log ADD COLUMN IF NOT EXISTS image_alt text;
