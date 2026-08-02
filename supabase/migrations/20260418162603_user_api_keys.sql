-- Personal Access Tokens (PATs) for CLI authentication
-- Token format: mog_<32-char-base62>, stored as SHA-256 hash

CREATE TABLE IF NOT EXISTS user_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  scopes TEXT[] NOT NULL DEFAULT ARRAY['read']::TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX user_api_keys_user_id_idx ON user_api_keys(user_id);
CREATE INDEX user_api_keys_token_hash_idx ON user_api_keys(token_hash) WHERE revoked_at IS NULL;

-- Enable RLS
ALTER TABLE user_api_keys ENABLE ROW LEVEL SECURITY;

-- RLS policies: users can manage their own keys, service role bypasses
CREATE POLICY "user_api_keys_select" ON user_api_keys
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "user_api_keys_insert" ON user_api_keys
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "user_api_keys_update" ON user_api_keys
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "user_api_keys_delete" ON user_api_keys
  FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "user_api_keys_service_role" ON user_api_keys
  FOR ALL USING (auth.role() = 'service_role');
