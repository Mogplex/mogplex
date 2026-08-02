-- Recovered from the remote migration history table. This change was
-- applied directly to production on 2026-07-30 (PostgREST max_rows
-- hardening session) via the management API, which records history
-- without a repo file — leaving `supabase db push` unable to reconcile
-- and blocking the deploy-production workflow. Committing the file
-- restores a consistent history; db push skips already-applied versions.

-- Service-role management policies: service_role bypasses RLS entirely, so
-- these policies only added a per-row auth.role() evaluation for every other
-- role. Scoping them TO service_role clears the multiple_permissive_policies
-- and auth_rls_initplan advisors with no access change.
alter policy "Service role can manage ai_models" on public.ai_models to service_role using (true);
alter policy "Service role can manage model_supersessions" on public.model_supersessions to service_role using (true);
alter policy "sandbox_launch_presets_service_role" on public.sandbox_launch_presets to service_role using (true);
alter policy "user_api_keys_service_role" on public.user_api_keys to service_role using (true);

-- Evaluate auth.uid() once per statement instead of per row.
alter policy "profiles_insert" on public.profiles with check ((select auth.uid()) = auth_user_id);
alter policy "workspaces_select" on public.workspaces using ((select auth.uid()) = user_id);
alter policy "workspaces_insert" on public.workspaces with check ((select auth.uid()) = user_id);
alter policy "workspaces_update" on public.workspaces using ((select auth.uid()) = user_id);
alter policy "workspaces_delete" on public.workspaces using ((select auth.uid()) = user_id);
alter policy "user_api_keys_select" on public.user_api_keys using ((select auth.uid()) = user_id);
alter policy "user_api_keys_insert" on public.user_api_keys with check ((select auth.uid()) = user_id);
alter policy "user_api_keys_update" on public.user_api_keys using ((select auth.uid()) = user_id);
alter policy "user_api_keys_delete" on public.user_api_keys using ((select auth.uid()) = user_id);
alter policy "sandbox_launch_presets_select" on public.sandbox_launch_presets using ((select auth.uid()) = user_id);
alter policy "sandbox_launch_presets_insert" on public.sandbox_launch_presets with check ((select auth.uid()) = user_id);
alter policy "sandbox_launch_presets_update" on public.sandbox_launch_presets using ((select auth.uid()) = user_id);
alter policy "sandbox_launch_presets_delete" on public.sandbox_launch_presets using ((select auth.uid()) = user_id);
alter policy "owner_select" on public.connection_events using (user_id = (select auth.uid()));
