-- Install the bridge and backfill in one transaction. Existing readers remain
-- available; legacy writes wait until the snapshot and triggers agree.
lock table public."oauthApplication", public."oauthAccessToken", public."oauthConsent"
  in share row exclusive mode;

create schema if not exists mogplex_auth;
revoke all on schema mogplex_auth from public;

create function mogplex_auth.token_hash(value text) returns text
language sql immutable strict parallel safe set search_path = pg_catalog
as $$ select translate(rtrim(encode(sha256(convert_to(value, 'UTF8')), 'base64'), '='), '+/', '-_') $$;

create function mogplex_auth.scopes(value text) returns text
language sql immutable parallel safe set search_path = pg_catalog
as $$ select to_jsonb(case when btrim(coalesce(value, '')) = '' then '{}'::text[]
  else regexp_split_to_array(btrim(value), '\s+') end)::text $$;

create function mogplex_auth.copy_client(r public."oauthApplication", replace_existing boolean default true)
returns void language sql set search_path = pg_catalog, public
as $$
  insert into public."oauthClient" (
    id, "clientId", "clientSecret", disabled, "skipConsent", "subjectType",
    scopes, "userId", "createdAt", "updatedAt", name, icon, "redirectUris",
    "tokenEndpointAuthMethod", "applicationType", "grantTypes", "responseTypes",
    "requirePKCE", metadata, "legacySecretMethods"
  ) values (
    r.id::text, r."clientId",
    case when r.type = 'public' then null else mogplex_auth.token_hash(nullif(r."clientSecret", '')) end,
    coalesce(r.disabled, false), false, 'public',
    to_jsonb(array['openid','profile','email','offline_access','read','write'])::text,
    r."userId", r."createdAt", r."updatedAt", r.name, r.icon,
    to_jsonb(string_to_array(r."redirectUrls", ','))::text,
    case when r.type = 'public' or coalesce(r."clientSecret", '') = '' then 'none'
      else 'client_secret_basic' end,
    case when r."clientId" = 'mogplex-cli' then 'native' else 'web' end,
    to_jsonb(array['authorization_code','refresh_token'])::text, to_jsonb(array['code'])::text, true, r.metadata::jsonb, true
  ) on conflict ("clientId") do update set
    "clientSecret" = excluded."clientSecret", disabled = excluded.disabled,
    "userId" = excluded."userId", "updatedAt" = excluded."updatedAt",
    name = excluded.name, icon = excluded.icon, "redirectUris" = excluded."redirectUris",
    "tokenEndpointAuthMethod" = excluded."tokenEndpointAuthMethod", metadata = excluded.metadata
  where replace_existing;
$$;

create function mogplex_auth.copy_token(r public."oauthAccessToken", replace_existing boolean default true)
returns void language plpgsql set search_path = pg_catalog, public
as $$
begin
  -- A null user was never an authenticated Mogplex MCP principal. Keep that
  -- legacy row intact, but do not invent a user for a refresh credential.
  if r."userId" is not null then
    insert into public."oauthRefreshToken" (
      id, token, "clientId", "userId", "authorizationCodeId", "expiresAt", "createdAt", scopes
    ) values (
      r.id::text, mogplex_auth.token_hash(r."refreshToken"), r."clientId", r."userId",
      'legacy:' || r.id::text, r."refreshTokenExpiresAt", r."createdAt", mogplex_auth.scopes(r.scopes)
    ) on conflict (id) do update set
      token = excluded.token, "clientId" = excluded."clientId", "userId" = excluded."userId",
      "expiresAt" = excluded."expiresAt", scopes = excluded.scopes
    where replace_existing;
  end if;
  insert into public."oauthAccessTokenV2" (
    id, token, "clientId", "userId", "authorizationCodeId", "refreshId", "expiresAt", "createdAt", scopes, "legacyOpaque"
  ) values (
    r.id::text, mogplex_auth.token_hash(r."accessToken"), r."clientId", r."userId",
    'legacy:' || r.id::text, case when r."userId" is null then null else r.id::text end,
    r."accessTokenExpiresAt", r."createdAt", mogplex_auth.scopes(r.scopes), true
  ) on conflict (id) do update set
    revoked = case when "oauthAccessTokenV2".token is distinct from excluded.token then null
      else "oauthAccessTokenV2".revoked end,
    token = excluded.token, "clientId" = excluded."clientId", "userId" = excluded."userId",
    "expiresAt" = excluded."expiresAt", scopes = excluded.scopes
  where replace_existing;
end
$$;

create function mogplex_auth.copy_consent(r public."oauthConsent", replace_existing boolean default true)
returns void language plpgsql set search_path = pg_catalog, public
as $$
begin
  if r."consentGiven" then
    insert into public."oauthConsentV2" (id, "clientId", "userId", scopes, "createdAt", "updatedAt")
    values (r.id::text, r."clientId", r."userId", mogplex_auth.scopes(r.scopes), r."createdAt", r."updatedAt")
    on conflict (id) do update set scopes = excluded.scopes, "updatedAt" = excluded."updatedAt"
    where replace_existing;
  elsif replace_existing then
    delete from public."oauthConsentV2" where "clientId" = r."clientId" and "userId" = r."userId";
  end if;
end
$$;

create function mogplex_auth.legacy_client_changed() returns trigger
language plpgsql set search_path = pg_catalog, public
as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if tg_op = 'DELETE' then
    delete from public."oauthClient" where "clientId" = old."clientId";
    return old;
  end if;
  perform mogplex_auth.copy_client(new);
  return new;
end
$$;

create function mogplex_auth.legacy_token_changed() returns trigger
language plpgsql set search_path = pg_catalog, public
as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if tg_op = 'DELETE' then
    delete from public."oauthRefreshToken" where "authorizationCodeId" = 'legacy:' || old.id::text;
    delete from public."oauthAccessTokenV2" where "authorizationCodeId" = 'legacy:' || old.id::text;
    return old;
  end if;
  if tg_op = 'UPDATE' and (
    old."refreshTokenExpiresAt" <= clock_timestamp() or exists (
      select 1 from public."oauthRefreshToken" where id = old.id::text and revoked is not null
    )
  ) and (
    (new."refreshTokenExpiresAt" > clock_timestamp() and (
      new."refreshTokenExpiresAt" > old."refreshTokenExpiresAt" or new."refreshToken" is distinct from old."refreshToken"
    )) or (new."accessTokenExpiresAt" > clock_timestamp() and (
      new."accessTokenExpiresAt" > old."accessTokenExpiresAt" or new."accessToken" is distinct from old."accessToken"
    ))
  ) then
    raise exception using errcode = '23514', constraint = 'legacy_oauth_rotation_after_revoke',
      message = 'A revoked or expired legacy OAuth grant cannot be renewed';
  end if;
  perform mogplex_auth.copy_token(new);
  return new;
end
$$;

create function mogplex_auth.legacy_consent_changed() returns trigger
language plpgsql set search_path = pg_catalog, public
as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if tg_op = 'DELETE' then
    delete from public."oauthConsentV2" where "clientId" = old."clientId" and "userId" = old."userId";
    return old;
  end if;
  perform mogplex_auth.copy_consent(new);
  return new;
end
$$;

create function mogplex_auth.provider_client_changed() returns trigger
language plpgsql set search_path = pg_catalog, public
as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if tg_op = 'DELETE' then
    delete from public."oauthApplication" where "clientId" = old."clientId";
    return old;
  end if;
  -- A rotated secret is deliberately unavailable to a retained 1.6 server:
  -- never leave its superseded plaintext secret usable there.
  update public."oauthApplication" r set disabled = coalesce(new.disabled, false) or (
    new."clientSecret" is distinct from case when r.type = 'public' then null
      else mogplex_auth.token_hash(nullif(r."clientSecret", '')) end
  ) where r."clientId" = new."clientId";
  return new;
end
$$;

create function mogplex_auth.provider_refresh_changed() returns trigger
language plpgsql set search_path = pg_catalog, public
as $$
declare token_id text;
begin
  if pg_trigger_depth() > 1 then return null; end if;
  token_id := case when tg_op = 'DELETE' then old.id else new.id end;
  if tg_op = 'DELETE' or new.revoked is not null then
    update public."oauthAccessToken" set
      "refreshTokenExpiresAt" = least("refreshTokenExpiresAt", clock_timestamp()),
      "accessTokenExpiresAt" = least("accessTokenExpiresAt", clock_timestamp())
    where id::text = token_id;
    update public."oauthAccessTokenV2" set revoked = coalesce(revoked, clock_timestamp())
    where "refreshId" = token_id;
  end if;
  return null;
end
$$;

create function mogplex_auth.provider_access_changed() returns trigger
language plpgsql set search_path = pg_catalog, public
as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if tg_op = 'DELETE' then
    update public."oauthAccessToken" set "accessTokenExpiresAt" = least("accessTokenExpiresAt", clock_timestamp())
      where id::text = old.id;
    return old;
  end if;
  update public."oauthAccessToken" set "accessTokenExpiresAt" = least(
    "accessTokenExpiresAt", new."expiresAt", case when new.revoked is null then 'infinity'::timestamptz else new.revoked end
  ) where id::text = new.id;
  return new;
end
$$;

create function mogplex_auth.provider_consent_changed() returns trigger
language plpgsql set search_path = pg_catalog, public
as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if tg_op = 'DELETE' then
    update public."oauthConsent" set "consentGiven" = false
      where "clientId" = old."clientId" and "userId" = old."userId";
    return old;
  end if;
  update public."oauthConsent" set scopes = array_to_string(array(select jsonb_array_elements_text(new.scopes::jsonb)), ' '), "consentGiven" = true,
    "updatedAt" = new."updatedAt" where id::text = new.id;
  return new;
end
$$;

create trigger oauth_legacy_client_bridge after insert or update or delete on public."oauthApplication"
  for each row execute function mogplex_auth.legacy_client_changed();
create trigger oauth_legacy_token_bridge after insert or update or delete on public."oauthAccessToken"
  for each row execute function mogplex_auth.legacy_token_changed();
create trigger oauth_legacy_consent_bridge after insert or update or delete on public."oauthConsent"
  for each row execute function mogplex_auth.legacy_consent_changed();
create trigger oauth_provider_client_bridge after update or delete on public."oauthClient"
  for each row execute function mogplex_auth.provider_client_changed();
create trigger oauth_provider_refresh_bridge after update of revoked or delete on public."oauthRefreshToken"
  for each row execute function mogplex_auth.provider_refresh_changed();
create trigger oauth_provider_access_bridge after update of revoked, "expiresAt" or delete on public."oauthAccessTokenV2"
  for each row execute function mogplex_auth.provider_access_changed();
create trigger oauth_provider_consent_bridge after update or delete on public."oauthConsentV2"
  for each row execute function mogplex_auth.provider_consent_changed();

-- Copy values, never rewrite or mass-expire source credentials at cutover.
do $backfill$
begin
  perform mogplex_auth.copy_client(r, false) from public."oauthApplication" r;
  perform mogplex_auth.copy_token(r, false) from public."oauthAccessToken" r;
  perform mogplex_auth.copy_consent(r, false) from public."oauthConsent" r;
end
$backfill$;

revoke all on all functions in schema mogplex_auth from public;
do $permissions$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then
    grant usage on schema mogplex_auth to service_role;
    grant execute on all functions in schema mogplex_auth to service_role;
  end if;
end
$permissions$;
