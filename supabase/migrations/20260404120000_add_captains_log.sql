-- Captain's Log content hub (public read, admin write)

CREATE TABLE IF NOT EXISTS captains_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  slug text NOT NULL UNIQUE,
  content text NOT NULL,
  image_url text,
  category text NOT NULL CHECK (category IN (
    'Launch Updates',
    'Water Adventures',
    'Boating Tips',
    'Local Highlights'
  )),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_captains_log_created_at ON captains_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_captains_log_category ON captains_log(category);
CREATE INDEX IF NOT EXISTS idx_captains_log_slug ON captains_log(slug);

ALTER TABLE captains_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view captains log"
  ON captains_log FOR SELECT
  USING (true);

CREATE POLICY "Admins can manage captains log"
  ON captains_log FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admins WHERE admins.id = auth.uid()
    )
  );
