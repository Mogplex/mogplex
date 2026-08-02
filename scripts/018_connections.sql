-- External API & MCP Server connections
CREATE TABLE connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('rest_api', 'mcp_server')),
  -- REST API fields
  base_url TEXT,
  auth_type TEXT CHECK (auth_type IN ('none', 'api_key', 'bearer', 'basic')),
  auth_header TEXT DEFAULT 'Authorization',
  -- MCP fields
  mcp_transport TEXT CHECK (mcp_transport IN ('sse', 'http')),
  mcp_url TEXT,
  -- Shared
  encrypted_credentials TEXT,
  description TEXT,
  is_enabled BOOLEAN DEFAULT true,
  health_status TEXT DEFAULT 'unknown',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS policies (owner-based, same pattern as other tables)
ALTER TABLE connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own connections"
  ON connections FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own connections"
  ON connections FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own connections"
  ON connections FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own connections"
  ON connections FOR DELETE
  USING (auth.uid() = user_id);
