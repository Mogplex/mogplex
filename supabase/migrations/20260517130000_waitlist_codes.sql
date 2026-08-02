-- Waitlist access codes for pre-launch GitHub OAuth gating.
--
-- A code must be redeemed (i.e. pass /api/auth/waitlist/validate) before the
-- /api/auth/login/github route will start the OAuth flow. Redemption is
-- atomic: a single UPDATE ... RETURNING * either claims a use slot or the
-- code is rejected. Codes with NULL max_uses are unlimited (useful for
-- shared launch codes); NULL expires_at means no expiry.
--
-- This migration is additive only — no existing tables are touched. Safe to
-- deploy ahead of any application code that reads it.

CREATE TABLE IF NOT EXISTS public.waitlist_codes (
  code        TEXT PRIMARY KEY,
  note        TEXT,
  max_uses    INTEGER,
  uses        INTEGER NOT NULL DEFAULT 0,
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT waitlist_codes_uses_nonneg CHECK (uses >= 0),
  CONSTRAINT waitlist_codes_max_uses_positive CHECK (
    max_uses IS NULL OR max_uses > 0
  ),
  CONSTRAINT waitlist_codes_uses_within_max CHECK (
    max_uses IS NULL OR uses <= max_uses
  )
);

-- Default-deny via RLS. Only the service role (which bypasses RLS) and any
-- future SECURITY DEFINER function may touch this table. The anon and
-- authenticated roles get no policy, so they see/write nothing.
ALTER TABLE public.waitlist_codes ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE  public.waitlist_codes IS
  'Pre-launch GitHub OAuth gate. Codes are redeemed via /api/auth/waitlist/validate using the service role.';
COMMENT ON COLUMN public.waitlist_codes.note IS
  'Free-text label for the operator: who/what this code was issued for.';
COMMENT ON COLUMN public.waitlist_codes.max_uses IS
  'NULL = unlimited. NUMERIC limit means the atomic redemption update rejects writes once uses = max_uses.';
COMMENT ON COLUMN public.waitlist_codes.expires_at IS
  'NULL = no expiry. Past timestamps are rejected by the redemption update.';

-- Atomic redemption. The single UPDATE either claims a use slot or no row is
-- touched. The follow-up SELECTs only run on failure, to distinguish missing
-- vs expired vs exhausted for an ergonomic API error. SECURITY DEFINER means
-- this RPC works against the RLS-locked table on behalf of the caller.
CREATE OR REPLACE FUNCTION public.redeem_waitlist_code(p_code TEXT)
RETURNS TABLE (ok BOOLEAN, reason TEXT) AS $$
BEGIN
  UPDATE public.waitlist_codes
     SET uses = uses + 1
   WHERE code = p_code
     AND (max_uses IS NULL OR uses < max_uses)
     AND (expires_at IS NULL OR expires_at > NOW());

  IF FOUND THEN
    RETURN QUERY SELECT TRUE, NULL::TEXT;
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.waitlist_codes WHERE code = p_code) THEN
    RETURN QUERY SELECT FALSE, 'invalid'::TEXT;
  ELSIF EXISTS (
    SELECT 1 FROM public.waitlist_codes
     WHERE code = p_code
       AND expires_at IS NOT NULL
       AND expires_at <= NOW()
  ) THEN
    RETURN QUERY SELECT FALSE, 'expired'::TEXT;
  ELSE
    RETURN QUERY SELECT FALSE, 'exhausted'::TEXT;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.redeem_waitlist_code(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_waitlist_code(TEXT) TO service_role;
