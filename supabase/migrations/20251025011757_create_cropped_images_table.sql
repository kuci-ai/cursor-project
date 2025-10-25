/*
  # Create cropped images storage schema

  1. New Tables
    - `cropped_images`
      - `id` (uuid, primary key) - Unique identifier for each cropped image
      - `user_id` (uuid, foreign key) - References auth.users
      - `image_data` (text) - Base64 encoded image data
      - `width` (integer) - Width of cropped image in pixels
      - `height` (integer) - Height of cropped image in pixels
      - `original_filename` (text) - Original filename if available
      - `created_at` (timestamptz) - Timestamp when image was created
      - `updated_at` (timestamptz) - Timestamp when image was last updated

  2. Security
    - Enable RLS on `cropped_images` table
    - Add policy for authenticated users to insert their own images
    - Add policy for authenticated users to view their own images
    - Add policy for authenticated users to delete their own images

  3. Indexes
    - Add index on user_id for faster queries
    - Add index on created_at for sorting
*/

CREATE TABLE IF NOT EXISTS cropped_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  image_data text NOT NULL,
  width integer DEFAULT 0,
  height integer DEFAULT 0,
  original_filename text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE cropped_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own cropped images"
  ON cropped_images FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own cropped images"
  ON cropped_images FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own cropped images"
  ON cropped_images FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_cropped_images_user_id ON cropped_images(user_id);
CREATE INDEX IF NOT EXISTS idx_cropped_images_created_at ON cropped_images(created_at DESC);
