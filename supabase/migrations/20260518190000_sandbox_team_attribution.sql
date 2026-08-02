alter table public.sandboxes
  add column if not exists product_team_id uuid null references public.teams(id) on delete set null,
  add column if not exists actor_user_id uuid null references public.profiles(id) on delete set null;

create index if not exists sandboxes_product_team_id_idx
  on public.sandboxes (product_team_id);

create index if not exists sandboxes_actor_user_id_idx
  on public.sandboxes (actor_user_id);

create index if not exists sandboxes_user_team_active_idx
  on public.sandboxes (user_id, product_team_id, repo_id, working_branch, root_directory, created_at desc)
  where status in ('creating', 'installing', 'running', 'paused');
