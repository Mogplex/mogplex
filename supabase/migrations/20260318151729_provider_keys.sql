-- Mapping table: user + provider → vault secret ID
CREATE TABLE IF NOT EXISTS provider_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('anthropic', 'openai')),
  vault_secret_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, provider)
);

ALTER TABLE provider_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_select" ON provider_keys
  FOR SELECT USING (auth.uid() = user_id);

-- Store or update a provider API key in the vault
CREATE OR REPLACE FUNCTION store_provider_key(
  p_user_id UUID,
  p_provider TEXT,
  p_key TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_secret_id UUID;
  v_new_secret_id UUID;
BEGIN
  SELECT vault_secret_id INTO v_existing_secret_id
  FROM provider_keys
  WHERE user_id = p_user_id AND provider = p_provider;

  IF v_existing_secret_id IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE id = v_existing_secret_id;
  END IF;

  INSERT INTO vault.secrets (secret, name, description)
  VALUES (
    p_key,
    p_user_id || '/' || p_provider,
    'Provider API key for ' || p_provider
  )
  RETURNING id INTO v_new_secret_id;

  INSERT INTO provider_keys (user_id, provider, vault_secret_id, updated_at)
  VALUES (p_user_id, p_provider, v_new_secret_id, NOW())
  ON CONFLICT (user_id, provider)
  DO UPDATE SET vault_secret_id = v_new_secret_id, updated_at = NOW();
END;
$$;

-- Retrieve decrypted provider API key
CREATE OR REPLACE FUNCTION get_provider_key(
  p_user_id UUID,
  p_provider TEXT
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret_id UUID;
  v_decrypted TEXT;
BEGIN
  SELECT vault_secret_id INTO v_secret_id
  FROM provider_keys
  WHERE user_id = p_user_id AND provider = p_provider;

  IF v_secret_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret INTO v_decrypted
  FROM vault.decrypted_secrets
  WHERE id = v_secret_id;

  RETURN v_decrypted;
END;
$$;

-- Delete a provider API key from vault and mapping
CREATE OR REPLACE FUNCTION delete_provider_key(
  p_user_id UUID,
  p_provider TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret_id UUID;
BEGIN
  SELECT vault_secret_id INTO v_secret_id
  FROM provider_keys
  WHERE user_id = p_user_id AND provider = p_provider;

  IF v_secret_id IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE id = v_secret_id;
    DELETE FROM provider_keys WHERE user_id = p_user_id AND provider = p_provider;
  END IF;
END;
$$;;
