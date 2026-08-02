ALTER TABLE connections
  ADD COLUMN IF NOT EXISTS last_tested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_test_error TEXT,
  ADD COLUMN IF NOT EXISTS last_test_http_status INTEGER,
  ADD COLUMN IF NOT EXISTS last_test_tool_count INTEGER;
