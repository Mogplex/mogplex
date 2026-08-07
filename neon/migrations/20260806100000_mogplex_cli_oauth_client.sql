-- First-party public OAuth client for the mogplex CLI.
--
-- The CLI signs in via authorization-code + PKCE against the Better Auth
-- `mcp` plugin endpoints (/api/auth/mcp/authorize + /token). Public client:
-- no secret ships in the CLI; PKCE (S256) is the security boundary, which
-- the token endpoint enforces for `type = 'public'` clients.
--
-- Redirect URIs are exact-matched by Better Auth, so the CLI binds fixed
-- loopback ports (24816 primary, 24818 fallback — see
-- mogplex-cli/packages/auth/src/loopback.ts). Both hostname forms are
-- registered; the CLI sends the 127.0.0.1 form.

insert into "oauthApplication" (
  "id",
  "name",
  "clientId",
  "clientSecret",
  "redirectUrls",
  "type",
  "disabled",
  "createdAt",
  "updatedAt"
) values (
  gen_random_uuid(),
  'Mogplex CLI',
  'mogplex-cli',
  '',
  'http://127.0.0.1:24816/auth/callback,http://127.0.0.1:24818/auth/callback,http://localhost:24816/auth/callback,http://localhost:24818/auth/callback',
  'public',
  false,
  now(),
  now()
)
on conflict ("clientId") do update set
  "redirectUrls" = excluded."redirectUrls",
  "type" = excluded."type",
  "disabled" = excluded."disabled",
  "updatedAt" = now();
