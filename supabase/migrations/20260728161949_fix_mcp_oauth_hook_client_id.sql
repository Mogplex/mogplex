-- Supabase Auth delivers the OAuth client id as a top-level field on the hook
-- event, not inside claims. The original hook only read claims, so issued
-- tokens kept the default "authenticated" audience and the MCP API rejected
-- every OAuth request with 401.
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
  oauth_client_id := coalesce(
    event ->> 'client_id',
    claims ->> 'client_id',
    claims ->> 'azp'
  );

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
    -- The verifier requires a client_id claim; write it explicitly rather
    -- than depending on Supabase including it in the final token.
    claims := jsonb_set(
      claims,
      '{client_id}',
      to_jsonb(oauth_client_id),
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
