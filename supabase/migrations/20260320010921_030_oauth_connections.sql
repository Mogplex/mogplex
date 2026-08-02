ALTER TABLE connections DROP CONSTRAINT IF EXISTS connections_auth_type_check;
ALTER TABLE connections ADD CONSTRAINT connections_auth_type_check
  CHECK (auth_type IN ('none', 'api_key', 'bearer', 'basic', 'oauth'));

ALTER TABLE connections
  ADD COLUMN oauth_client_id TEXT,
  ADD COLUMN oauth_authorize_url TEXT,
  ADD COLUMN oauth_token_url TEXT,
  ADD COLUMN oauth_scopes TEXT,
  ADD COLUMN oauth_token_expires_at TIMESTAMPTZ;

CREATE INDEX idx_connections_oauth_expires ON connections(oauth_token_expires_at)
  WHERE auth_type = 'oauth' AND oauth_token_expires_at IS NOT NULL;;
