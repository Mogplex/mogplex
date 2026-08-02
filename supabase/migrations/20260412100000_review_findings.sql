create table if not exists public.review_findings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  job_run_id uuid not null references public.job_runs(id) on delete cascade,
  repo_id uuid references public.repos(id) on delete set null,
  repo_full_name text,
  pr_number integer,
  head_sha text,
  ordinal integer not null,
  fingerprint text not null,
  severity text not null check (severity in ('critical', 'warning', 'suggestion')),
  title text not null,
  body text not null,
  path text,
  line integer,
  status text not null default 'open' check (status in ('open', 'issue_created', 'dismissed')),
  issue_number integer,
  issue_url text,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_run_id, ordinal)
);

create index if not exists idx_review_findings_job_ordinal
  on public.review_findings (job_run_id, ordinal asc);

create index if not exists idx_review_findings_user_created
  on public.review_findings (user_id, created_at desc);

create index if not exists idx_review_findings_repo_fingerprint
  on public.review_findings (repo_id, fingerprint, status)
  where repo_id is not null;

alter table public.review_findings enable row level security;

drop policy if exists "owner_access" on public.review_findings;
create policy "owner_access" on public.review_findings
  for all
  using (user_id = public.current_profile_id())
  with check (user_id = public.current_profile_id());
