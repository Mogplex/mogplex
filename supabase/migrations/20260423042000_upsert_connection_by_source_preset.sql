create or replace function public.upsert_connection_by_source_preset(
  p_user_id uuid,
  p_source_preset text,
  p_name text,
  p_type text,
  p_auth_type text,
  p_auth_header text,
  p_mcp_transport text,
  p_mcp_url text,
  p_encrypted_credentials text,
  p_description text,
  p_oauth_client_id text,
  p_oauth_authorize_url text,
  p_oauth_token_url text,
  p_oauth_scopes text,
  p_oauth_authorized_at timestamptz,
  p_oauth_token_expires_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_connection_id uuid;
begin
  if p_source_preset is null or btrim(p_source_preset) = '' then
    raise exception 'source_preset is required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_user_id::text || ':' || p_source_preset, 5504)
  );

  select id into v_connection_id
  from public.connections
  where user_id = p_user_id and source_preset = p_source_preset
  order by created_at
  limit 1
  for update;

  if v_connection_id is null then
    insert into public.connections (
      user_id,
      source_preset,
      name,
      type,
      auth_type,
      auth_header,
      mcp_transport,
      mcp_url,
      encrypted_credentials,
      description,
      oauth_client_id,
      oauth_authorize_url,
      oauth_token_url,
      oauth_scopes,
      oauth_authorized_at,
      oauth_token_expires_at
    ) values (
      p_user_id,
      p_source_preset,
      p_name,
      p_type,
      p_auth_type,
      p_auth_header,
      p_mcp_transport,
      p_mcp_url,
      p_encrypted_credentials,
      p_description,
      p_oauth_client_id,
      p_oauth_authorize_url,
      p_oauth_token_url,
      p_oauth_scopes,
      p_oauth_authorized_at,
      p_oauth_token_expires_at
    )
    returning id into v_connection_id;
  else
    update public.connections
    set
      name = p_name,
      type = p_type,
      auth_type = p_auth_type,
      auth_header = p_auth_header,
      mcp_transport = p_mcp_transport,
      mcp_url = p_mcp_url,
      encrypted_credentials = p_encrypted_credentials,
      description = p_description,
      oauth_client_id = p_oauth_client_id,
      oauth_authorize_url = p_oauth_authorize_url,
      oauth_token_url = p_oauth_token_url,
      oauth_scopes = p_oauth_scopes,
      oauth_authorized_at = p_oauth_authorized_at,
      oauth_token_expires_at = p_oauth_token_expires_at,
      updated_at = now()
    where id = v_connection_id;
  end if;

  return v_connection_id;
end;
$$;

revoke all on function public.upsert_connection_by_source_preset(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  timestamptz,
  timestamptz
) from public;

grant execute on function public.upsert_connection_by_source_preset(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  timestamptz,
  timestamptz
) to service_role;
