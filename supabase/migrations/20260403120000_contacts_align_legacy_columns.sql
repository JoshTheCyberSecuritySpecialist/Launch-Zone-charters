-- Upgrade path: older installs used full_name + phone

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'contacts' AND column_name = 'full_name'
  ) THEN
    ALTER TABLE contacts RENAME COLUMN full_name TO name;
  END IF;
END $$;

ALTER TABLE contacts DROP COLUMN IF EXISTS phone;
