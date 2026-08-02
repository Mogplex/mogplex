ALTER TABLE public.repos
  ADD COLUMN IF NOT EXISTS owner TEXT,
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS default_branch TEXT NOT NULL DEFAULT 'main',
  ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN NOT NULL DEFAULT false;

UPDATE public.repos
SET
  owner = COALESCE(owner, NULLIF(split_part(full_name, '/', 1), '')),
  name = COALESCE(name, NULLIF(split_part(full_name, '/', 2), '')),
  default_branch = COALESCE(NULLIF(default_branch, ''), 'main')
WHERE
  owner IS NULL
  OR name IS NULL
  OR default_branch IS NULL
  OR default_branch = '';

ALTER TABLE public.repos DROP CONSTRAINT IF EXISTS repos_github_id_key;

DO $$
BEGIN
  ALTER TABLE public.repos
    ADD CONSTRAINT repos_user_id_github_id_key UNIQUE (user_id, github_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS repos_user_id_favorite_full_name_idx
  ON public.repos (user_id, is_favorite DESC, full_name);
