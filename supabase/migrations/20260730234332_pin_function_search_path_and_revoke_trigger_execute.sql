-- Recovered from the remote migration history table. This change was
-- applied directly to production on 2026-07-30 (PostgREST max_rows
-- hardening session) via the management API, which records history
-- without a repo file — leaving `supabase db push` unable to reconcile
-- and blocking the deploy-production workflow. Committing the file
-- restores a consistent history; db push skips already-applied versions.

-- Pin search_path on functions flagged by the function_search_path_mutable
-- advisor. "public, extensions" matches the runtime search path these already
-- execute under (db_extra_search_path), so behavior is unchanged; pinning
-- prevents search-path hijacking for definer/trigger contexts.
alter function public.agent_categories_enforce_limit() set search_path = public, extensions;
alter function public.compute_ai_call_cost() set search_path = public, extensions;
alter function public.external_agent_runs_set_updated_at() set search_path = public, extensions;
alter function public.guard_ai_calls_gateway_cost_usd() set search_path = public, extensions;
alter function public.record_waitlist_request(p_email text, p_name text, p_company text, p_use_case text, p_source text) set search_path = public, extensions;
alter function public.rollup_job_run_cost() set search_path = public, extensions;
alter function public.sandbox_compute_cost_on_stop() set search_path = public, extensions;
alter function public.team_provider_keys_set_updated_at() set search_path = public, extensions;
alter function public.teams_set_updated_at() set search_path = public, extensions;
alter function public.tg_profiles_slug_guard() set search_path = public, extensions;
alter function public.tg_teams_slug_guard() set search_path = public, extensions;
alter function public.touch_sandbox_launch_presets_updated_at() set search_path = public, extensions;

-- Trigger functions never need direct EXECUTE from client roles: Postgres
-- checks EXECUTE at CREATE TRIGGER time (against the trigger creator), not
-- when DML fires the trigger. Revoking clears the SECURITY DEFINER
-- executable-by-anon/authenticated advisors without affecting trigger firing.
revoke execute on function public.tg_profiles_null_team_members_invited_by() from public, anon, authenticated;
revoke execute on function public.tg_team_members_owner_floor() from public, anon, authenticated;
revoke execute on function public.tg_team_seed_owner() from public, anon, authenticated;
revoke execute on function public.delete_flow_webhook_secret() from public, anon, authenticated;
