-- Review transcripts belong to the run, not to memories. No age-based expiry.
create table public.pr_review_checkpoints (
  job_run_id uuid not null references public.job_runs(id) on delete cascade,
  node_id text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  fingerprint text not null,
  checkpoint jsonb not null check (jsonb_typeof(checkpoint) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (job_run_id, node_id)
);
create index pr_review_checkpoints_user_id_idx
  on public.pr_review_checkpoints(user_id);
alter table public.pr_review_checkpoints enable row level security;
-- Server-only: a checkpoint can contain private source code and tool results.
revoke all on public.pr_review_checkpoints from public;
-- Neon does not create Supabase client roles. Revoke any default client
-- grants when those roles exist in a legacy installation.
do $$
declare client_role text;
begin
  foreach client_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = client_role) then
      execute format('revoke all on public.pr_review_checkpoints from %I', client_role);
    end if;
  end loop;
end;
$$;
grant all on public.pr_review_checkpoints to service_role;
