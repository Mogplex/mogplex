alter table public.flow_templates
  add column if not exists owner_type text not null default 'user',
  add column if not exists owner_user_id uuid references public.profiles(id) on delete cascade,
  add column if not exists product_team_id uuid references public.teams(id) on delete cascade,
  add column if not exists created_by_user_id uuid references public.profiles(id) on delete set null;

-- Keep inserts from the currently deployed personal-template code compatible
-- during the schema-first deploy window. That version only supplies user_id.
create or replace function public.set_flow_template_ownership_defaults()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.owner_type = 'user' and new.owner_user_id is null then
    new.owner_user_id := new.user_id;
  end if;
  if new.created_by_user_id is null then
    new.created_by_user_id := new.user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists set_flow_template_ownership_defaults
  on public.flow_templates;
create trigger set_flow_template_ownership_defaults
  before insert on public.flow_templates
  for each row execute function public.set_flow_template_ownership_defaults();

update public.flow_templates
set
  owner_type = 'user',
  owner_user_id = coalesce(owner_user_id, user_id),
  product_team_id = null,
  created_by_user_id = coalesce(created_by_user_id, user_id)
where owner_type = 'user'
  and (
    owner_user_id is null
    or product_team_id is not null
    or created_by_user_id is null
  );

alter table public.flow_templates
  drop constraint if exists flow_templates_owner_type_check,
  add constraint flow_templates_owner_type_check
    check (owner_type in ('user', 'team')) not valid,
  drop constraint if exists flow_templates_owner_shape_check,
  add constraint flow_templates_owner_shape_check check (
    (
      owner_type = 'user'
      and owner_user_id is not null
      and product_team_id is null
    )
    or
    (
      owner_type = 'team'
      and owner_user_id is null
      and product_team_id is not null
    )
  ) not valid;

alter table public.flow_templates
  validate constraint flow_templates_owner_type_check;
alter table public.flow_templates
  validate constraint flow_templates_owner_shape_check;

create index if not exists flow_templates_personal_updated_idx
  on public.flow_templates (owner_user_id, updated_at desc, id desc)
  where owner_type = 'user';

create index if not exists flow_templates_team_updated_idx
  on public.flow_templates (product_team_id, updated_at desc, id desc)
  where owner_type = 'team';

create index if not exists flow_templates_created_by_user_id_idx
  on public.flow_templates (created_by_user_id);

drop policy if exists "Users can manage own flow templates"
  on public.flow_templates;
drop policy if exists flow_templates_select
  on public.flow_templates;
drop policy if exists flow_templates_insert
  on public.flow_templates;
drop policy if exists flow_templates_update
  on public.flow_templates;
drop policy if exists flow_templates_delete
  on public.flow_templates;

create policy flow_templates_select
  on public.flow_templates for select
  using (
    (
      owner_type = 'user'
      and owner_user_id = (select public.current_profile_id())
    )
    or
    (
      owner_type = 'team'
      and public.is_team_member(product_team_id)
    )
  );

create policy flow_templates_insert
  on public.flow_templates for insert
  with check (
    (
      owner_type = 'user'
      and owner_user_id = (select public.current_profile_id())
      and product_team_id is null
      and user_id = (select public.current_profile_id())
      and created_by_user_id = (select public.current_profile_id())
    )
    or
    (
      owner_type = 'team'
      and owner_user_id is null
      and public.user_team_role(product_team_id)
        in ('owner', 'admin', 'developer')
      and user_id = (select public.current_profile_id())
      and created_by_user_id = (select public.current_profile_id())
    )
  );

create policy flow_templates_delete
  on public.flow_templates for delete
  using (
    (
      owner_type = 'user'
      and owner_user_id = (select public.current_profile_id())
    )
    or
    (
      owner_type = 'team'
      and public.user_team_role(product_team_id)
        in ('owner', 'admin', 'developer')
    )
  );
