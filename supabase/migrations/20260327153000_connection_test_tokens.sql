ALTER TABLE public.connections
  ADD COLUMN IF NOT EXISTS active_test_token UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_connections_active_test_token
  ON public.connections (active_test_token)
  WHERE active_test_token IS NOT NULL;
