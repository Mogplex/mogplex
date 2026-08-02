ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS github_auth_mode TEXT NOT NULL DEFAULT 'oauth';

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_github_auth_mode_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_github_auth_mode_check
    CHECK (github_auth_mode IN ('oauth', 'app'));

ALTER TABLE public.repos
  ADD COLUMN IF NOT EXISTS github_installation_id BIGINT;

CREATE TABLE IF NOT EXISTS public.github_installations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  installation_id BIGINT NOT NULL,
  account_login TEXT,
  account_type TEXT,
  target_type TEXT,
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT github_installations_user_installation_key UNIQUE (user_id, installation_id)
);

CREATE INDEX IF NOT EXISTS repos_user_installation_idx
  ON public.repos (user_id, github_installation_id);

CREATE INDEX IF NOT EXISTS github_installations_user_idx
  ON public.github_installations (user_id, installation_id);

UPDATE public.profiles
SET github_auth_mode = CASE
  WHEN github_token IS NOT NULL AND github_token <> '' THEN 'oauth'
  ELSE 'oauth'
END
WHERE github_auth_mode IS NULL
   OR github_auth_mode NOT IN ('oauth', 'app');;
