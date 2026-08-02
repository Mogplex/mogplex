-- Team attachment for GitHub App installations.
-- When set, the team can list/use repos installed under this installation.
-- Detaching nulls this column only; team-owned repos are not reverted.

alter table public.github_installations
  add column if not exists product_team_id uuid
    references public.teams(id) on delete set null;

create index if not exists github_installations_product_team_id_idx
  on public.github_installations (product_team_id)
  where product_team_id is not null;

comment on column public.github_installations.product_team_id is
  'When set, this installation row is attached to a team. Detach by nulling.';
