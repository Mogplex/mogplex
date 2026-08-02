-- Add title column to conversations for history display
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS title TEXT;
