-- Replacement-code flow for the /login "Get a new code" link. Existing users
-- whose `mogplex_waitlist_ok` cookie isn't present on a device (new laptop,
-- cleared cookies, expired) can request a single-use code by email.
--
-- The lookup against auth.users and the insert into waitlist_codes happen in
-- one SECURITY DEFINER function so:
--   (a) we don't have to expose auth.users to the app role, and
--   (b) callers can't time-attack the "did this email exist" boundary.
-- Returns the new code on success, NULL when no matching user exists. The
-- route returns a generic 200 either way to avoid leaking existence.

CREATE OR REPLACE FUNCTION public.mint_waitlist_replacement_code(
  p_email TEXT
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id UUID;
  v_code    TEXT;
BEGIN
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE lower(email) = lower(p_email)
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  v_code := 'r-' || encode(gen_random_bytes(8), 'hex');

  INSERT INTO public.waitlist_codes (code, note, max_uses, expires_at)
  VALUES (
    v_code,
    'replacement for ' || lower(p_email),
    1,
    NOW() + INTERVAL '24 hours'
  );

  RETURN v_code;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mint_waitlist_replacement_code(TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.mint_waitlist_replacement_code(TEXT)
  TO service_role;

COMMENT ON FUNCTION public.mint_waitlist_replacement_code(TEXT) IS
  'Mint a single-use 24h replacement waitlist code for an existing auth user, or return NULL if the email is unknown. Service role only.';
