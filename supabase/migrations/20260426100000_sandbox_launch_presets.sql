-- Saved launch presets for the sandbox Start dialog.
--
-- Captures the recurring monorepo case: a user who repeatedly launches
-- e.g. "apps/web on feature/x" can save that combination as a named
-- preset and recall it with one click. Each preset literally captures
-- the values the user submitted at save time — if the repo's
-- root_directory or default_branch later changes, the preset still
-- launches at its captured values until the user re-saves it. This
-- avoids the "preset surprised me" failure mode where presets silently
-- track moving repo state.
--
-- Scope (intentional v1):
--   - path + branch + create-branch flag (the SandboxLaunchChoice shape)
--   - per-(user, repo) name uniqueness
--   - NO env-var capture (envs already live on repos.* and apply
--     automatically); revisit if users ask
--   - NO global / cross-repo presets; revisit if multi-monorepo users
--     emerge

CREATE TABLE IF NOT EXISTS public.sandbox_launch_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  repo_id UUID NOT NULL REFERENCES public.repos(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- Path semantics mirror SandboxLaunchRequestInput.rootDirectory:
  --   NULL  → explicit "repo root" launch override (or repo has no
  --           default subdirectory at all)
  --   text  → relative subdirectory the sandbox will run in
  -- A "no override; follow repo default at apply time" mode is
  -- intentionally NOT supported in v1 — that's a mutable target and
  -- would surprise users.
  root_directory TEXT,
  base_branch TEXT NOT NULL,
  working_branch TEXT NOT NULL,
  create_branch BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sandbox_launch_presets_user_repo_idx
  ON public.sandbox_launch_presets(user_id, repo_id);

-- Names are unique per (user, repo). Trying to save with an existing
-- name overwrites in the application layer (UPSERT), which the user
-- agrees to via the dialog's "Saved" feedback.
CREATE UNIQUE INDEX IF NOT EXISTS sandbox_launch_presets_user_repo_name_unique
  ON public.sandbox_launch_presets(user_id, repo_id, name);

ALTER TABLE public.sandbox_launch_presets ENABLE ROW LEVEL SECURITY;

-- Defense-in-depth RLS. The server path uses the service-role key with
-- explicit user_id filters on every query (per AGENTS.md memory rule);
-- these policies guard direct DB or anon/authenticated JWT access.
CREATE POLICY "sandbox_launch_presets_select" ON public.sandbox_launch_presets
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "sandbox_launch_presets_insert" ON public.sandbox_launch_presets
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "sandbox_launch_presets_update" ON public.sandbox_launch_presets
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "sandbox_launch_presets_delete" ON public.sandbox_launch_presets
  FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "sandbox_launch_presets_service_role" ON public.sandbox_launch_presets
  FOR ALL USING (auth.role() = 'service_role');

-- Mirror the existing convention from `repos` etc. for keeping
-- updated_at in sync on UPDATE.
CREATE OR REPLACE FUNCTION public.touch_sandbox_launch_presets_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER sandbox_launch_presets_touch_updated_at
  BEFORE UPDATE ON public.sandbox_launch_presets
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_sandbox_launch_presets_updated_at();
