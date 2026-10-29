-- Additive Better Auth 1.7.7 storage. Legacy OAuth tables stay intact.
-- Fields follow the installed provider/JWT schema; existing identity FKs
-- retain the existing identity contract. Other ids are text (assertion ids
-- are provider-generated replay keys, not UUIDs).
-- Better Auth Kysely serializes string lists as JSON text, not PG arrays.

create table public."jwks" (
  id text primary key,
  "publicKey" text not null,
  "privateKey" text not null,
  "createdAt" timestamptz not null,
  "expiresAt" timestamptz,
  "alg" text,
  "crv" text
);

create table public."oauthClient" (
  id text primary key,
  "legacySecretMethods" boolean not null default false,
  "clientId" text not null unique,
  "clientSecret" text,
  "clientDiscoveryId" text,
  "disabled" boolean default false,
  "skipConsent" boolean,
  "enableEndSession" boolean,
  "subjectType" text,
  "scopes" text,
  "clientCredentialsScopes" text default '[]',
  "userId" uuid references public."user" ("id") on delete cascade,
  "createdAt" timestamptz,
  "updatedAt" timestamptz,
  "name" text,
  "uri" text,
  "icon" text,
  "contacts" text,
  "tos" text,
  "policy" text,
  "softwareId" text,
  "softwareVersion" text,
  "softwareStatement" text,
  "redirectUris" text not null,
  "postLogoutRedirectUris" text,
  "backchannelLogoutUri" text,
  "backchannelLogoutSessionRequired" boolean,
  "tokenEndpointAuthMethod" text,
  "applicationType" text,
  "jwks" text,
  "jwksUri" text,
  "grantTypes" text,
  "responseTypes" text,
  "requirePKCE" boolean,
  "dpopBoundAccessTokens" boolean default false,
  "referenceId" text,
  "metadata" jsonb
);

create table public."oauthResource" (
  id text primary key,
  "identifier" text not null unique,
  "name" text not null,
  "accessTokenTtl" double precision,
  "refreshTokenTtl" double precision,
  "signingAlgorithm" text,
  "signingKeyId" text,
  "allowedScopes" text,
  "customClaims" jsonb,
  "dpopBoundAccessTokensRequired" boolean default false,
  "disabled" boolean default false,
  "createdAt" timestamptz,
  "updatedAt" timestamptz,
  "policyVersion" double precision default 1,
  "metadata" jsonb
);

create table public."oauthClientResource" (
  id text primary key,
  "clientId" text not null references public."oauthClient" ("clientId") on delete cascade,
  "resourceId" text not null references public."oauthResource" ("identifier") on delete cascade,
  "metadata" jsonb,
  "createdAt" timestamptz
);

create table public."oauthRefreshToken" (
  id text primary key,
  "token" text not null unique,
  "clientId" text not null references public."oauthClient" ("clientId") on delete cascade,
  "sessionId" text references public."session" ("id") on delete set null,
  "userId" uuid not null references public."user" ("id") on delete cascade,
  "referenceId" text,
  "authorizationCodeId" text,
  "resources" text,
  "requestedUserInfoClaims" text,
  "expiresAt" timestamptz not null,
  "createdAt" timestamptz not null,
  "revoked" timestamptz,
  "rotatedAt" timestamptz,
  "rotationReplayResponse" text,
  "rotationReplayExpiresAt" timestamptz,
  "authTime" timestamptz,
  "confirmation" jsonb,
  "scopes" text not null
);

create table public."oauthAccessTokenV2" (
  id text primary key,
  "legacyOpaque" boolean not null default false,
  "token" text not null unique,
  "clientId" text not null references public."oauthClient" ("clientId") on delete cascade,
  "sessionId" text references public."session" ("id") on delete set null,
  "userId" uuid references public."user" ("id") on delete cascade,
  "referenceId" text,
  "authorizationCodeId" text,
  "resources" text,
  "requestedUserInfoClaims" text,
  "refreshId" text references public."oauthRefreshToken" ("id") on delete cascade,
  "expiresAt" timestamptz not null,
  "createdAt" timestamptz not null,
  "revoked" timestamptz,
  "confirmation" jsonb,
  "scopes" text not null
);

create table public."oauthConsentV2" (
  id text primary key,
  "clientId" text not null references public."oauthClient" ("clientId") on delete cascade,
  "userId" uuid references public."user" ("id") on delete cascade,
  "referenceId" text,
  "resources" text,
  "requestedUserInfoClaims" text,
  "scopes" text not null,
  "createdAt" timestamptz not null,
  "updatedAt" timestamptz not null
);

create table public."oauthClientAssertion" (
  id text primary key,
  "expiresAt" timestamptz not null
);

create index "oauthClient_userId_idx" on public."oauthClient" ("userId");
create index "oauthClientResource_clientId_idx" on public."oauthClientResource" ("clientId");
create index "oauthClientResource_resourceId_idx" on public."oauthClientResource" ("resourceId");
create unique index "oauthClientResource_clientId_resourceId_idx" on public."oauthClientResource" ("clientId", "resourceId");
create index "oauthRefreshToken_clientId_idx" on public."oauthRefreshToken" ("clientId");
create index "oauthRefreshToken_sessionId_idx" on public."oauthRefreshToken" ("sessionId");
create index "oauthRefreshToken_userId_idx" on public."oauthRefreshToken" ("userId");
create index "oauthRefreshToken_authorizationCodeId_idx" on public."oauthRefreshToken" ("authorizationCodeId");
create index "oauthAccessTokenV2_clientId_idx" on public."oauthAccessTokenV2" ("clientId");
create index "oauthAccessTokenV2_sessionId_idx" on public."oauthAccessTokenV2" ("sessionId");
create index "oauthAccessTokenV2_userId_idx" on public."oauthAccessTokenV2" ("userId");
create index "oauthAccessTokenV2_authorizationCodeId_idx" on public."oauthAccessTokenV2" ("authorizationCodeId");
create index "oauthAccessTokenV2_refreshId_idx" on public."oauthAccessTokenV2" ("refreshId");
create index "oauthConsentV2_clientId_idx" on public."oauthConsentV2" ("clientId");
create index "oauthConsentV2_userId_idx" on public."oauthConsentV2" ("userId");

alter table public."jwks" enable row level security;
revoke all on table public."jwks" from public;
alter table public."oauthClient" enable row level security;
revoke all on table public."oauthClient" from public;
alter table public."oauthResource" enable row level security;
revoke all on table public."oauthResource" from public;
alter table public."oauthClientResource" enable row level security;
revoke all on table public."oauthClientResource" from public;
alter table public."oauthRefreshToken" enable row level security;
revoke all on table public."oauthRefreshToken" from public;
alter table public."oauthAccessTokenV2" enable row level security;
revoke all on table public."oauthAccessTokenV2" from public;
alter table public."oauthConsentV2" enable row level security;
revoke all on table public."oauthConsentV2" from public;
alter table public."oauthClientAssertion" enable row level security;
revoke all on table public."oauthClientAssertion" from public;

-- Match existing server-owned auth tables: clients get no direct grants;
-- service_role keeps its established BYPASSRLS server-side boundary.
do $permissions$
declare
  role_name text;
  table_name text;
begin
  foreach table_name in array array['jwks','oauthClient','oauthResource','oauthClientResource','oauthRefreshToken','oauthAccessTokenV2','oauthConsentV2','oauthClientAssertion'] loop
    for role_name in select rolname from pg_catalog.pg_roles where rolname in ('anon', 'authenticated') loop
      execute format('revoke all on table public.%I from %I', table_name, role_name);
    end loop;
    if exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then
      execute format('grant select, insert, update, delete on table public.%I to service_role', table_name);
    end if;
  end loop;
end
$permissions$;
