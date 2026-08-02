-- Add Vercel OAuth fields to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS vercel_id TEXT UNIQUE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS vercel_token TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email TEXT;

-- Create index for vercel_id lookups
CREATE INDEX IF NOT EXISTS idx_profiles_vercel_id ON profiles(vercel_id);
