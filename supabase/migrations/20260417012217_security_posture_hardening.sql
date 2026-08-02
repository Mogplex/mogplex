ALTER TABLE public.github_installations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "github_installations_select" ON public.github_installations;
DROP POLICY IF EXISTS "github_installations_insert" ON public.github_installations;
DROP POLICY IF EXISTS "github_installations_update" ON public.github_installations;
DROP POLICY IF EXISTS "github_installations_delete" ON public.github_installations;

CREATE POLICY "github_installations_select"
  ON public.github_installations
  FOR SELECT
  USING (user_id = public.current_profile_id());

CREATE POLICY "github_installations_insert"
  ON public.github_installations
  FOR INSERT
  WITH CHECK (user_id = public.current_profile_id());

CREATE POLICY "github_installations_update"
  ON public.github_installations
  FOR UPDATE
  USING (user_id = public.current_profile_id())
  WITH CHECK (user_id = public.current_profile_id());

CREATE POLICY "github_installations_delete"
  ON public.github_installations
  FOR DELETE
  USING (user_id = public.current_profile_id());

ALTER FUNCTION public.enforce_assignment_agent_ownership()
  SET search_path = public;

ALTER FUNCTION public.enforce_trigger_agent_ownership()
  SET search_path = public;
