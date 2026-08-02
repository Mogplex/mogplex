ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS harness_state JSONB NOT NULL DEFAULT '{}'::jsonb;
