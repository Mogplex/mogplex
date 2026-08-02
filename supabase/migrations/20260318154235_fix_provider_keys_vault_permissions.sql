-- Fix: use vault.create_secret() instead of direct INSERT into vault.secrets
-- The vault API functions have SECURITY DEFINER with pgsodium access

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
  -- Check for existing mapping
  SELECT vault_secret_id INTO v_existing_secret_id
  FROM provider_keys
  WHERE user_id = p_user_id AND provider = p_provider;

  IF v_existing_secret_id IS NOT NULL THEN
    -- Remove old secret
    DELETE FROM vault.secrets WHERE id = v_existing_secret_id;
  END IF;

  -- Use vault.create_secret() which has pgsodium permissions
  SELECT vault.create_secret(
    p_key,
    p_user_id || '/' || p_provider,
    'Provider API key for ' || p_provider
  ) INTO v_new_secret_id;

  -- Upsert mapping
  INSERT INTO provider_keys (user_id, provider, vault_secret_id, updated_at)
  VALUES (p_user_id, p_provider, v_new_secret_id, NOW())
  ON CONFLICT (user_id, provider)
  DO UPDATE SET vault_secret_id = v_new_secret_id, updated_at = NOW();
END;
$$;

-- get_provider_key and delete_provider_key don't touch pgsodium directly, but
-- recreate them with consistent style

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
