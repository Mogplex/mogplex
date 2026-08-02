-- Recovered from the remote migration history table. This change was
-- applied directly to production on 2026-07-30 (PostgREST max_rows
-- hardening session) via the management API, which records history
-- without a repo file — leaving `supabase db push` unable to reconcile
-- and blocking the deploy-production workflow. Committing the file
-- restores a consistent history; db push skips already-applied versions.

-- team_members_write was FOR ALL, so its SELECT arm overlapped with
-- team_members_select (multiple_permissive_policies advisor). is_team_admin()
-- implies is_team_member() (both derive from user_team_role()), so admins
-- never relied on the write policy for reads. Split it into the three write
-- commands; access is unchanged.
drop policy "team_members_write" on public.team_members;
create policy "team_members_insert" on public.team_members
  for insert with check (is_team_admin(team_id));
create policy "team_members_update" on public.team_members
  for update using (is_team_admin(team_id)) with check (is_team_admin(team_id));
create policy "team_members_delete" on public.team_members
  for delete using (is_team_admin(team_id));
