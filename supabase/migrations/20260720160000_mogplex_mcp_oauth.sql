-- OAuth clients are dynamically registered by MCP hosts, then admitted only
-- after a signed-in Mogplex user explicitly approves the consent screen.
create table if not exists public.mcp_oauth_clients (
  client_id text primary key,
  client_name text not null,
  resource_url text not null,
  approved_by uuid not null references auth.users(id) on delete cascade,
  approved_at timestamptz not null default now(),
  last_authorized_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mcp_oauth_clients_client_id_length check (
    char_length(client_id) between 1 and 512
  ),
  constraint mcp_oauth_clients_client_name_length check (
    char_length(client_name) between 1 and 512
  ),
  constraint mcp_oauth_clients_resource_url_length check (
    char_length(resource_url) between 1 and 2048
  )
);

alter table public.mcp_oauth_clients enable row level security;

revoke all on table public.mcp_oauth_clients from public, anon, authenticated;
grant select on table public.mcp_oauth_clients to supabase_auth_admin;
grant select, insert, update, delete on table public.mcp_oauth_clients to service_role;

create policy "supabase_auth_admin_reads_mcp_oauth_clients"
  on public.mcp_oauth_clients
  for select
  to supabase_auth_admin
  using (true);

-- Supabase Auth invokes this hook when it issues an access token. Only clients
-- approved through Mogplex consent receive the MCP resource audience. The API
-- rejects tokens whose audience is anything else.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  claims jsonb;
  oauth_client_id text;
  oauth_resource_url text;
begin
  claims := event -> 'claims';
  oauth_client_id := coalesce(claims ->> 'client_id', claims ->> 'azp');

  if oauth_client_id is not null then
    select resource_url
    into oauth_resource_url
    from public.mcp_oauth_clients
    where client_id = oauth_client_id;
  end if;

  if oauth_resource_url is not null then
    claims := jsonb_set(
      claims,
      '{aud}',
      to_jsonb(oauth_resource_url),
      true
    );
    event := jsonb_set(event, '{claims}', claims, true);
  end if;

  return event;
end;
$$;

revoke all on function public.custom_access_token_hook(jsonb)
  from public, anon, authenticated;
grant execute on function public.custom_access_token_hook(jsonb)
  to supabase_auth_admin;
