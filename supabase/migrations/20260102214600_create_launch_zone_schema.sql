/*
  # Launch Zone Charters Database Schema

  ## Overview
  Complete database schema for Launch Zone Charters pontoon boat rental and rocket launch platform.

  ## New Tables

  ### 1. boats
  Fleet management table storing all pontoon boats available for rental.
  - `id` (uuid, primary key)
  - `name` (text) - Boat name
  - `type` (text) - "standard" or "premium"
  - `capacity` (integer) - Maximum passengers
  - `description` (text) - Boat description
  - `image_url` (text) - Boat image
  - `hourly_rate` (numeric) - Base hourly rate
  - `half_day_rate` (numeric) - 4-hour rate
  - `full_day_rate` (numeric) - 8-hour rate
  - `is_active` (boolean) - Availability status
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ### 2. customers
  Customer information and contact details.
  - `id` (uuid, primary key)
  - `full_name` (text, required)
  - `email` (text, required, unique)
  - `phone` (text, required)
  - `id_document_url` (text) - Uploaded government ID
  - `sms_opt_in` (boolean) - SMS alerts consent
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ### 3. bookings
  All rental bookings with customer, boat, and payment information.
  - `id` (uuid, primary key)
  - `customer_id` (uuid, foreign key → customers)
  - `boat_id` (uuid, foreign key → boats)
  - `start_time` (timestamptz, required)
  - `end_time` (timestamptz, required)
  - `duration_hours` (numeric)
  - `rental_type` (text) - "hourly", "half_day", "full_day", "custom"
  - `captain_included` (boolean)
  - `captain_fee` (numeric)
  - `base_price` (numeric)
  - `peak_surcharge` (numeric)
  - `security_deposit` (numeric)
  - `total_price` (numeric)
  - `deposit_paid` (numeric)
  - `balance_due` (numeric)
  - `status` (text) - "pending", "confirmed", "cancelled", "completed"
  - `is_night_tour` (boolean)
  - `is_rocket_tour` (boolean)
  - `special_requests` (text)
  - `waiver_signed` (boolean)
  - `stripe_payment_id` (text)
  - `admin_notes` (text)
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ### 4. waivers
  Signed liability waivers for each booking.
  - `id` (uuid, primary key)
  - `booking_id` (uuid, foreign key → bookings)
  - `customer_id` (uuid, foreign key → customers)
  - `electronic_signature` (text, required)
  - `signature_date` (timestamptz, required)
  - `ip_address` (text)
  - `waiver_content` (text) - Full waiver text at time of signing
  - `accepted` (boolean)
  - `created_at` (timestamptz)

  ### 5. admins
  Administrator accounts for platform management.
  - `id` (uuid, primary key)
  - `email` (text, unique, required)
  - `full_name` (text)
  - `created_at` (timestamptz)

  ### 6. launches
  Rocket launch schedule and tracking data.
  - `id` (uuid, primary key)
  - `external_id` (text, unique) - API provider's launch ID
  - `mission_name` (text, required)
  - `provider` (text) - "SpaceX", "NASA", etc.
  - `rocket_type` (text)
  - `launch_pad` (text)
  - `launch_time` (timestamptz)
  - `launch_window_end` (timestamptz)
  - `status` (text) - "scheduled", "delayed", "scrubbed", "success"
  - `description` (text)
  - `live_stream_url` (text)
  - `ai_score` (numeric) - AI recommendation score 0-100
  - `ai_rating` (text) - "excellent", "good", "risky"
  - `ai_explanation` (text)
  - `weather_forecast` (jsonb)
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ### 7. sms_subscribers
  SMS notification subscriber list.
  - `id` (uuid, primary key)
  - `customer_id` (uuid, foreign key → customers)
  - `phone` (text, required)
  - `opt_in_date` (timestamptz)
  - `is_active` (boolean)
  - `created_at` (timestamptz)

  ### 8. blocked_dates
  Admin-managed unavailable dates.
  - `id` (uuid, primary key)
  - `boat_id` (uuid, foreign key → boats, nullable) - If null, blocks all boats
  - `start_time` (timestamptz, required)
  - `end_time` (timestamptz, required)
  - `reason` (text)
  - `created_by` (uuid, foreign key → admins)
  - `created_at` (timestamptz)

  ### 9. pricing_overrides
  Peak pricing rules for holidays and special events.
  - `id` (uuid, primary key)
  - `name` (text, required) - "Memorial Day Weekend", "Rocket Launch Premium"
  - `start_date` (timestamptz, required)
  - `end_date` (timestamptz, required)
  - `surcharge_percent` (numeric) - 10-20% typically
  - `is_active` (boolean)
  - `created_by` (uuid, foreign key → admins)
  - `created_at` (timestamptz)

  ### 10. site_settings
  Global configuration and settings.
  - `id` (uuid, primary key)
  - `key` (text, unique, required)
  - `value` (jsonb)
  - `updated_at` (timestamptz)

  ## Security
  - RLS enabled on all tables
  - Public read access for boats, launches (active only)
  - Customers can read own data only
  - Admins have full access
  - Bookings accessible by customer or admin
*/

-- Create boats table
CREATE TABLE IF NOT EXISTS boats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('standard', 'premium')),
  capacity integer NOT NULL,
  description text,
  image_url text,
  hourly_rate numeric(10,2) NOT NULL,
  half_day_rate numeric(10,2) NOT NULL,
  full_day_rate numeric(10,2) NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create customers table
CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  email text UNIQUE NOT NULL,
  phone text NOT NULL,
  id_document_url text,
  sms_opt_in boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create admins table
CREATE TABLE IF NOT EXISTS admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  full_name text,
  created_at timestamptz DEFAULT now()
);

-- Create bookings table
CREATE TABLE IF NOT EXISTS bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES customers(id) ON DELETE CASCADE,
  boat_id uuid REFERENCES boats(id) ON DELETE RESTRICT,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  duration_hours numeric(5,2) NOT NULL,
  rental_type text NOT NULL CHECK (rental_type IN ('hourly', 'half_day', 'full_day', 'custom')),
  captain_included boolean DEFAULT false,
  captain_fee numeric(10,2) DEFAULT 0,
  base_price numeric(10,2) NOT NULL,
  peak_surcharge numeric(10,2) DEFAULT 0,
  security_deposit numeric(10,2) DEFAULT 300,
  total_price numeric(10,2) NOT NULL,
  deposit_paid numeric(10,2) DEFAULT 0,
  balance_due numeric(10,2) NOT NULL,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed')),
  is_night_tour boolean DEFAULT false,
  is_rocket_tour boolean DEFAULT false,
  special_requests text,
  waiver_signed boolean DEFAULT false,
  stripe_payment_id text,
  admin_notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create waivers table
CREATE TABLE IF NOT EXISTS waivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid REFERENCES bookings(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES customers(id) ON DELETE CASCADE,
  electronic_signature text NOT NULL,
  signature_date timestamptz NOT NULL DEFAULT now(),
  ip_address text,
  waiver_content text NOT NULL,
  accepted boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Create launches table
CREATE TABLE IF NOT EXISTS launches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text UNIQUE,
  mission_name text NOT NULL,
  provider text,
  rocket_type text,
  launch_pad text,
  launch_time timestamptz,
  launch_window_end timestamptz,
  status text DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'delayed', 'scrubbed', 'success', 'failure')),
  description text,
  live_stream_url text,
  ai_score numeric(5,2),
  ai_rating text CHECK (ai_rating IN ('excellent', 'good', 'risky')),
  ai_explanation text,
  weather_forecast jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create sms_subscribers table
CREATE TABLE IF NOT EXISTS sms_subscribers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES customers(id) ON DELETE CASCADE,
  phone text NOT NULL,
  opt_in_date timestamptz DEFAULT now(),
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Create blocked_dates table
CREATE TABLE IF NOT EXISTS blocked_dates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  boat_id uuid REFERENCES boats(id) ON DELETE CASCADE,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  reason text,
  created_by uuid REFERENCES admins(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

-- Create pricing_overrides table
CREATE TABLE IF NOT EXISTS pricing_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  start_date timestamptz NOT NULL,
  end_date timestamptz NOT NULL,
  surcharge_percent numeric(5,2) NOT NULL,
  is_active boolean DEFAULT true,
  created_by uuid REFERENCES admins(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

-- Create site_settings table
CREATE TABLE IF NOT EXISTS site_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  value jsonb,
  updated_at timestamptz DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_bookings_customer ON bookings(customer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_boat ON bookings(boat_id);
CREATE INDEX IF NOT EXISTS idx_bookings_start_time ON bookings(start_time);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_launches_launch_time ON launches(launch_time);
CREATE INDEX IF NOT EXISTS idx_launches_status ON launches(status);
CREATE INDEX IF NOT EXISTS idx_blocked_dates_boat ON blocked_dates(boat_id);
CREATE INDEX IF NOT EXISTS idx_blocked_dates_time ON blocked_dates(start_time, end_time);

-- Enable Row Level Security
ALTER TABLE boats ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE waivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE launches ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_subscribers ENABLE ROW LEVEL SECURITY;
ALTER TABLE blocked_dates ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies for boats (public read for active boats)
CREATE POLICY "Anyone can view active boats"
  ON boats FOR SELECT
  USING (is_active = true);

CREATE POLICY "Admins can manage boats"
  ON boats FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admins WHERE admins.id = auth.uid()
    )
  );

-- RLS Policies for customers
CREATE POLICY "Customers can view own data"
  ON customers FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "Anyone can create customer records"
  ON customers FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Customers can update own data"
  ON customers FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY "Admins can view all customers"
  ON customers FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admins WHERE admins.id = auth.uid()
    )
  );

-- RLS Policies for admins
CREATE POLICY "Admins can view all admins"
  ON admins FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admins WHERE admins.id = auth.uid()
    )
  );

-- RLS Policies for bookings
CREATE POLICY "Customers can view own bookings"
  ON bookings FOR SELECT
  USING (customer_id = auth.uid());

CREATE POLICY "Anyone can create bookings"
  ON bookings FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Customers can update own bookings"
  ON bookings FOR UPDATE
  USING (customer_id = auth.uid())
  WITH CHECK (customer_id = auth.uid());

CREATE POLICY "Admins can manage all bookings"
  ON bookings FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admins WHERE admins.id = auth.uid()
    )
  );

-- RLS Policies for waivers
CREATE POLICY "Customers can view own waivers"
  ON waivers FOR SELECT
  USING (customer_id = auth.uid());

CREATE POLICY "Anyone can create waivers"
  ON waivers FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Admins can view all waivers"
  ON waivers FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admins WHERE admins.id = auth.uid()
    )
  );

-- RLS Policies for launches (public read)
CREATE POLICY "Anyone can view launches"
  ON launches FOR SELECT
  USING (true);

CREATE POLICY "Admins can manage launches"
  ON launches FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admins WHERE admins.id = auth.uid()
    )
  );

-- RLS Policies for sms_subscribers
CREATE POLICY "Customers can view own SMS subscription"
  ON sms_subscribers FOR SELECT
  USING (customer_id = auth.uid());

CREATE POLICY "Anyone can subscribe to SMS"
  ON sms_subscribers FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Customers can update own SMS subscription"
  ON sms_subscribers FOR UPDATE
  USING (customer_id = auth.uid())
  WITH CHECK (customer_id = auth.uid());

CREATE POLICY "Admins can manage SMS subscribers"
  ON sms_subscribers FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admins WHERE admins.id = auth.uid()
    )
  );

-- RLS Policies for blocked_dates (public read to check availability)
CREATE POLICY "Anyone can view blocked dates"
  ON blocked_dates FOR SELECT
  USING (true);

CREATE POLICY "Admins can manage blocked dates"
  ON blocked_dates FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admins WHERE admins.id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM admins WHERE admins.id = auth.uid()
    )
  );

-- RLS Policies for pricing_overrides (public read)
CREATE POLICY "Anyone can view active pricing overrides"
  ON pricing_overrides FOR SELECT
  USING (is_active = true);

CREATE POLICY "Admins can manage pricing overrides"
  ON pricing_overrides FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admins WHERE admins.id = auth.uid()
    )
  );

-- RLS Policies for site_settings (public read)
CREATE POLICY "Anyone can view site settings"
  ON site_settings FOR SELECT
  USING (true);

CREATE POLICY "Admins can manage site settings"
  ON site_settings FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admins WHERE admins.id = auth.uid()
    )
  );

-- Insert default boats
INSERT INTO boats (name, type, capacity, description, hourly_rate, half_day_rate, full_day_rate, is_active) VALUES
('Sea Breeze', 'standard', 10, 'Comfortable standard pontoon perfect for family outings and casual cruises. Equipped with sun shade, cooler space, and bluetooth sound system.', 120.00, 380.00, 700.00, true),
('Ocean Vista', 'standard', 10, 'Reliable standard pontoon ideal for exploring the waterways. Features ample seating, storage, and safety equipment.', 120.00, 380.00, 700.00, true),
('Luxury Wave', 'premium', 12, 'Premium pontoon with upgraded amenities including premium seating, enhanced sound system, and additional comfort features.', 150.00, 480.00, 900.00, true),
('Captain''s Choice', 'premium', 12, 'Top-tier premium pontoon boat with luxury seating, premium electronics, and all the amenities for an unforgettable experience.', 150.00, 480.00, 900.00, true)
ON CONFLICT DO NOTHING;

-- Insert default site settings
INSERT INTO site_settings (key, value) VALUES
('security_deposit_amount', '300'),
('captain_hourly_rate', '50'),
('captain_half_day_rate', '250'),
('minimum_booking_hours', '24'),
('same_day_booking_enabled', 'true'),
('night_tours_enabled', 'true')
ON CONFLICT (key) DO NOTHING;