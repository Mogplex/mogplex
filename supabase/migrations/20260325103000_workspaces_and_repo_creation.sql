CREATE TABLE IF NOT EXISTS public.workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workspaces_user_id_created_at_idx
  ON public.workspaces (user_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS workspaces_user_id_default_idx
  ON public.workspaces (user_id)
  WHERE is_default = true;

CREATE UNIQUE INDEX IF NOT EXISTS workspaces_user_id_name_key
  ON public.workspaces (user_id, lower(name));

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY "workspaces_select" ON public.workspaces FOR SELECT USING (auth.uid() = user_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "workspaces_insert" ON public.workspaces FOR INSERT WITH CHECK (auth.uid() = user_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "workspaces_update" ON public.workspaces FOR UPDATE USING (auth.uid() = user_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "workspaces_delete" ON public.workspaces FOR DELETE USING (auth.uid() = user_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.repos
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id);

INSERT INTO public.workspaces (user_id, name, description, is_default)
SELECT DISTINCT
  repos.user_id,
  'Imported Repos',
  'Auto-created to organize synced GitHub repos.',
  true
FROM public.repos
WHERE repos.user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.workspaces
    WHERE workspaces.user_id = repos.user_id
      AND workspaces.is_default = true
  );

UPDATE public.repos
SET workspace_id = workspaces.id
FROM public.workspaces
WHERE repos.user_id = workspaces.user_id
  AND workspaces.is_default = true
  AND repos.workspace_id IS NULL;

ALTER TABLE public.repos
  ALTER COLUMN workspace_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS repos_user_id_workspace_id_idx
  ON public.repos (user_id, workspace_id);

ALTER TABLE public.repos
  DROP CONSTRAINT IF EXISTS repos_user_id_github_id_key;

DROP INDEX IF EXISTS repos_user_id_github_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS repos_user_id_github_id_root_directory_key
  ON public.repos (user_id, github_id, COALESCE(root_directory, ''));
