-- Better Auth MCP provider persistence. These tables replace the Supabase
-- OAuth grants previously advertised by the hosted MCP protected resource.
--
-- Better Auth's configured generateId function returns UUID strings. Keep
-- both record ids and user references native uuid so they match the already
-- migrated Better Auth "user" table in Neon.

create table "oauthApplication" (
  "id" uuid not null primary key,
  "name" text not null,
  "icon" text,
  "metadata" text,
  "clientId" text not null unique,
  "clientSecret" text,
  "redirectUrls" text not null,
  "type" text not null,
  "disabled" boolean,
  "userId" uuid references "user" ("id") on delete cascade,
  "createdAt" timestamptz not null,
  "updatedAt" timestamptz not null
);

create table "oauthAccessToken" (
  "id" uuid not null primary key,
  "accessToken" text not null unique,
  "refreshToken" text not null unique,
  "accessTokenExpiresAt" timestamptz not null,
  "refreshTokenExpiresAt" timestamptz not null,
  "clientId" text not null references "oauthApplication" ("clientId") on delete cascade,
  "userId" uuid references "user" ("id") on delete cascade,
  "scopes" text not null,
  "createdAt" timestamptz not null,
  "updatedAt" timestamptz not null
);

create table "oauthConsent" (
  "id" uuid not null primary key,
  "clientId" text not null references "oauthApplication" ("clientId") on delete cascade,
  "userId" uuid not null references "user" ("id") on delete cascade,
  "scopes" text not null,
  "createdAt" timestamptz not null,
  "updatedAt" timestamptz not null,
  "consentGiven" boolean not null
);

create index "oauthApplication_userId_idx"
  on "oauthApplication" ("userId");

create index "oauthAccessToken_clientId_idx"
  on "oauthAccessToken" ("clientId");

create index "oauthAccessToken_userId_idx"
  on "oauthAccessToken" ("userId");

create index "oauthConsent_clientId_idx"
  on "oauthConsent" ("clientId");

create index "oauthConsent_userId_idx"
  on "oauthConsent" ("userId");
