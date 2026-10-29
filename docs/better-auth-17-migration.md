# Better Auth 1.7 OAuth migration

Better Auth 1.7 removes the bundled MCP provider. Mogplex uses the matching
OAuth provider and JWT packages while retaining its existing MCP bearer API,
issuer, RS256 signing algorithm and cached `/api/auth/mcp/*` endpoints.

The two Neon migrations are additive. They preserve `oauthApplication`,
`oauthAccessToken`, `oauthConsent`, browser sessions and password accounts.
Existing client IDs, client secrets, opaque access tokens, refresh tokens,
redirects, scopes and expiry times remain usable without reconnecting.
Migrated confidential clients retain both Basic and form credential transports,
which 1.6 accepted without persisting the declared method. New registrations
retain native method binding; ambiguous credentials still fail validation.

The new provider stores hashed client secrets and token lookup keys. Its access
and consent tables use separate physical names (`oauthAccessTokenV2` and
`oauthConsentV2`) so retained releases keep their original schema. PostgreSQL
triggers synchronize retained-release writes and propagate client disabling,
connection deletion and refresh revocation. A revoked legacy refresh cannot
mint fresh credentials through an old writer.

New JWT access tokens also have a server-side record. MCP and UserInfo require
that record in addition to native cryptographic validation, preserving immediate
connection revocation. Only migration-marked opaque credentials may omit an
audience; new MCP credentials must target the configured MCP resource.

New connections use a signed consent request and PKCE. Hosted refreshes retain
their existing long lifetime; CLI issuance retains the 30-day inactivity window.
The existing global auth-rate policy governs the OAuth endpoints.
No resource rows are seeded by importing auth during an environment-free build.

## Release and compatibility

Use the canonical production deployment workflow. It checks the release serving
on Vercel, runs retained-release compatibility, applies both migrations
transactionally, and deploys the matching app and Trigger worker. Do not run the
SQL or modify its migration ledger manually. Keep `BETTER_AUTH_SECRET` unchanged.

The compatibility fixture seeds credentials with the previous release, applies
the new migrations, then uses the previous SDK to authenticate the original
bearer and exercises retained SQL rotation/deletion. Candidate integration tests
use the real provider and PostgreSQL to verify original refresh credentials,
browser cookies, consent/PKCE, invalid credentials, expiry and revocation.

Preserving retained reads and writes is not an authorization to remove the old
tables or bridge. Keep them until dependent releases and workers retire. An
unmodified 1.6 app cannot interpret newly issued 1.7-only grants; recovery after
new issuance should retain the 1.7 compatibility layer and roll forward.

## CI database forks

CI forks copy production's encrypted JWKS rows, but browser tests deliberately
use a fixture-only `BETTER_AUTH_SECRET`. After applying candidate migrations,
`scripts/prepare-ci-auth-fixture.ts` verifies the new branch's identity with
Neon, resolves its own connection URI, and clears signing keys only in that
run's temporary fork before any browser shard starts. The native provider then
creates keys encrypted with the test secret. Client, session and refresh-token
rows remain intact.

The initializer rejects default/protected branches, unexpected run identities,
and the source database endpoint (including its pooled alias). It never runs on
the shared-database fallback. Keep production signing keys and
`BETTER_AUTH_SECRET` unchanged when fixing CI fork failures.
