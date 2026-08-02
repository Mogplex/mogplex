create table if not exists public.user_mcp_servers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  enabled boolean not null default true,
  transport text not null check (transport in ('stdio', 'http')),
  command text,
  args jsonb not null default '[]'::jsonb,
  env_refs jsonb not null default '{}'::jsonb,
  env_plain jsonb not null default '{}'::jsonb,
  url text,
  header_refs jsonb not null default '{}'::jsonb,
  header_plain jsonb not null default '{}'::jsonb,
  extra jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_mcp_servers_name_unique unique (user_id, name),
  constraint user_mcp_servers_name_no_reserved check (position('__' in name) = 0),
  constraint user_mcp_servers_transport_fields check (
    (transport = 'stdio' and command is not null and url is null)
    or
    (transport = 'http' and url is not null and command is null)
  ),
  constraint user_mcp_servers_args_is_array check (jsonb_typeof(args) = 'array'),
  constraint user_mcp_servers_env_refs_is_object check (jsonb_typeof(env_refs) = 'object'),
  constraint user_mcp_servers_env_plain_is_object check (jsonb_typeof(env_plain) = 'object'),
  constraint user_mcp_servers_header_refs_is_object check (jsonb_typeof(header_refs) = 'object'),
  constraint user_mcp_servers_header_plain_is_object check (jsonb_typeof(header_plain) = 'object'),
  constraint user_mcp_servers_extra_is_object check (jsonb_typeof(extra) = 'object')
);

create index if not exists user_mcp_servers_user_id_idx
  on public.user_mcp_servers (user_id, created_at desc);

alter table public.user_mcp_servers enable row level security;

drop policy if exists "user_mcp_servers_select" on public.user_mcp_servers;
create policy "user_mcp_servers_select" on public.user_mcp_servers
  for select using (user_id = public.current_profile_id());

drop policy if exists "user_mcp_servers_insert" on public.user_mcp_servers;
create policy "user_mcp_servers_insert" on public.user_mcp_servers
  for insert with check (user_id = public.current_profile_id());

drop policy if exists "user_mcp_servers_update" on public.user_mcp_servers;
create policy "user_mcp_servers_update" on public.user_mcp_servers
  for update using (user_id = public.current_profile_id())
  with check (user_id = public.current_profile_id());

drop policy if exists "user_mcp_servers_delete" on public.user_mcp_servers;
create policy "user_mcp_servers_delete" on public.user_mcp_servers
  for delete using (user_id = public.current_profile_id());

create or replace function public.user_mcp_servers_set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_mcp_servers_set_updated_at on public.user_mcp_servers;

create trigger user_mcp_servers_set_updated_at
  before update on public.user_mcp_servers
  for each row
  execute function public.user_mcp_servers_set_updated_at();

create or replace function public.create_user_mcp_server_secret(
  p_user_id uuid,
  p_server_id uuid,
  p_slot text,
  p_secret text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret_id uuid;
begin
  select vault.create_secret(
    p_secret,
    'user_mcp_servers/' || p_user_id || '/' || p_server_id || '/' || p_slot,
    'MCP server secret for ' || p_slot
  ) into v_secret_id;

  return v_secret_id;
end;
$$;

create or replace function public.update_user_mcp_server_secret(
  p_secret_id uuid,
  p_user_id uuid,
  p_server_id uuid,
  p_slot text,
  p_secret text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform vault.update_secret(
    p_secret_id,
    p_secret,
    'user_mcp_servers/' || p_user_id || '/' || p_server_id || '/' || p_slot,
    'MCP server secret for ' || p_slot
  );
end;
$$;

create or replace function public.delete_user_mcp_server_secret(
  p_secret_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from vault.secrets where id = p_secret_id;
end;
$$;

create or replace function public.count_user_mcp_server_secrets(
  p_user_id uuid,
  p_secret_ids uuid[]
) returns bigint
language sql
security definer
set search_path = public
as $$
  select count(*)::bigint
  from vault.secrets
  where id = any(coalesce(p_secret_ids, '{}'::uuid[]))
    and name like 'user_mcp_servers/' || p_user_id || '/%';
$$;

create or replace function public.cleanup_user_mcp_server_secrets()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret_id_text text;
begin
  for v_secret_id_text in
    (
      select value
      from jsonb_each_text(
        case
          when tg_op = 'DELETE' then old.env_refs
          else coalesce(old.env_refs, '{}'::jsonb)
        end
      )
      union
      select value
      from jsonb_each_text(
        case
          when tg_op = 'DELETE' then old.header_refs
          else coalesce(old.header_refs, '{}'::jsonb)
        end
      )
    )
    except
    (
      select value
      from jsonb_each_text(
        case
          when tg_op = 'DELETE' then '{}'::jsonb
          else coalesce(new.env_refs, '{}'::jsonb)
        end
      )
      union
      select value
      from jsonb_each_text(
        case
          when tg_op = 'DELETE' then '{}'::jsonb
          else coalesce(new.header_refs, '{}'::jsonb)
        end
      )
    )
  loop
    begin
      delete from vault.secrets where id = v_secret_id_text::uuid;
    exception
      when invalid_text_representation then
        null;
    end;
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists user_mcp_servers_cleanup_vault on public.user_mcp_servers;

create trigger user_mcp_servers_cleanup_vault
  after update or delete on public.user_mcp_servers
  for each row
  execute function public.cleanup_user_mcp_server_secrets();
