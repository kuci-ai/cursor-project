/*
  # Create user information table schema

  1. New Tables
    - `user_information`
      - `id` (uuid, primary key) - Unique identifier for each user info record
      - `user_id` (uuid, foreign key) - References auth.users (one-to-one relationship)
      - `first_name` (text) - User's first name
      - `last_name` (text) - User's last name
      - `email` (text) - User's email address (redundant with auth.users but useful for queries)
      - `phone` (text) - User's phone number
      - `date_of_birth` (date) - User's date of birth
      - `gender` (text) - User's gender (optional)
      - `address` (text) - User's address
      - `city` (text) - User's city
      - `state` (text) - User's state/province
      - `country` (text) - User's country
      - `postal_code` (text) - User's postal/zip code
      - `profile_image_url` (text) - URL to user's profile image
      - `bio` (text) - User's biography/description
      - `preferences` (jsonb) - User preferences and settings
      - `is_active` (boolean) - Whether the user account is active
      - `last_login_at` (timestamptz) - Last login timestamp
      - `email_verified` (boolean) - Whether email is verified
      - `phone_verified` (boolean) - Whether phone is verified
      - `created_at` (timestamptz) - Timestamp when record was created
      - `updated_at` (timestamptz) - Timestamp when record was last updated

  2. Security
    - Enable RLS on `user_information` table
    - Add policy for authenticated users to insert their own information
    - Add policy for authenticated users to view their own information
    - Add policy for authenticated users to update their own information
    - Add policy for authenticated users to delete their own information

  3. Indexes
    - Add unique index on user_id (one-to-one relationship)
    - Add index on email for faster lookups
    - Add index on created_at for sorting
    - Add index on is_active for filtering active users
*/

CREATE TABLE IF NOT EXISTS user_information (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  first_name text DEFAULT '',
  last_name text DEFAULT '',
  email text DEFAULT '',
  phone text DEFAULT '',
  date_of_birth date,
  gender text DEFAULT '',
  address text DEFAULT '',
  city text DEFAULT '',
  state text DEFAULT '',
  country text DEFAULT '',
  postal_code text DEFAULT '',
  profile_image_url text DEFAULT '',
  bio text DEFAULT '',
  preferences jsonb DEFAULT '{}',
  is_active boolean DEFAULT true,
  last_login_at timestamptz,
  email_verified boolean DEFAULT false,
  phone_verified boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE user_information ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can insert own information"
  ON user_information FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own information"
  ON user_information FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own information"
  ON user_information FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own information"
  ON user_information FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Indexes for performance
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_information_user_id ON user_information(user_id);
CREATE INDEX IF NOT EXISTS idx_user_information_email ON user_information(email);
CREATE INDEX IF NOT EXISTS idx_user_information_created_at ON user_information(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_information_is_active ON user_information(is_active);
CREATE INDEX IF NOT EXISTS idx_user_information_last_login ON user_information(last_login_at DESC);

-- Function to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to automatically update updated_at on row changes
CREATE TRIGGER update_user_information_updated_at
    BEFORE UPDATE ON user_information
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Function to sync email from auth.users
CREATE OR REPLACE FUNCTION sync_user_email()
RETURNS TRIGGER AS $$
BEGIN
    -- Update user_information email when auth.users email changes
    UPDATE user_information 
    SET email = NEW.email, updated_at = now()
    WHERE user_id = NEW.id;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to sync email changes from auth.users to user_information
CREATE TRIGGER sync_user_email_trigger
    AFTER UPDATE OF email ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION sync_user_email();
