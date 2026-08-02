ALTER TABLE public.sandboxes
  ADD COLUMN IF NOT EXISTS base_branch TEXT,
  ADD COLUMN IF NOT EXISTS working_branch TEXT;

UPDATE public.sandboxes AS sandboxes
SET
  base_branch = COALESCE(sandboxes.base_branch, repos.default_branch, 'main'),
  working_branch = COALESCE(sandboxes.working_branch, sandboxes.base_branch, repos.default_branch, 'main')
FROM public.repos AS repos
WHERE sandboxes.repo_id = repos.id
  AND (
    sandboxes.base_branch IS NULL
    OR sandboxes.working_branch IS NULL
  );

UPDATE public.sandboxes
SET
  base_branch = COALESCE(base_branch, 'main'),
  working_branch = COALESCE(working_branch, base_branch, 'main')
WHERE base_branch IS NULL
   OR working_branch IS NULL;

ALTER TABLE public.sandboxes
  ALTER COLUMN base_branch SET DEFAULT 'main',
  ALTER COLUMN base_branch SET NOT NULL,
  ALTER COLUMN working_branch SET DEFAULT 'main',
  ALTER COLUMN working_branch SET NOT NULL;
