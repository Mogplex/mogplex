-- Add user preference columns to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS default_model TEXT DEFAULT 'minimax/minimax-m2.5';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS theme TEXT DEFAULT 'dark' CHECK (theme IN ('dark', 'light', 'system'));
