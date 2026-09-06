# Neon runtime dependency audit

The serving stack is Neon Postgres, Better Auth, and PostgreSQL notifications
delivered to browsers over `/api/realtime/events`. Configure
`MOGPLEX_DATA_BACKEND=neon` on the web and worker runtimes and
`NEXT_PUBLIC_MOGPLEX_DATA_BACKEND=neon` **before building** the web app.
Supabase URL/key variables are not required in this mode.

## Runtime paths audited

| Surface | Neon behavior / correction |
| --- | --- |
| Control and shared route refresh | Initialize a Supabase client only inside the selected legacy subscription effect, never during render. All callers use the existing Neon SSE hook. |
| Workspace sandbox sync and repository dashboard | Existing Neon guards prevent legacy channel initialization. |
| Proxy, API identity, logout | Existing backend selection uses Better Auth in Neon mode. |
| Team invitation page | Resolve the current Mogplex profile using backend-aware auth, not a Supabase session. Keep profile identity separate from auth-user identity. |
| Old GitHub login and callback links | Restart at current `/login`, preserving only a validated local destination. Never pass old provider codes to Better Auth. |
| Old beta login / waitlist validation | Neon redirects the legacy page to current login; retired validation returns 410 without redeeming codes. The explicitly selected legacy backend retains its flow. |
| Old MCP consent and decision endpoints | Show restart instructions / return 410 in Neon mode. Old authorization IDs cannot be translated into a new issuer's grants. Origin checks still apply to decisions. |
| Team icon URLs | Use same-origin storage paths in Neon mode, retaining path validation. |
| Team icon replacement/removal | Neon storage implements bucket-scoped removal of exact paths; no wildcard or cross-bucket deletion. |
| Provider icons | Existing Neon URL, upload, list, and serving paths use the app origin and `storage_objects`. |
| Background jobs and Control continuation listeners | Data access uses the Neon adapter; continuation watchers select PostgreSQL LISTEN in Neon mode. Worker environment sync remains necessary. |
| Docker, Compose, and setup docs | Expose the public backend flag at build time; do not require or inject dummy Supabase credentials for Neon. |
| Production migration workflow | Neon runs when `DATABASE_URL` is configured; the optional Supabase step requires `SUPABASE_DB_URL`. The repository secret-name audit on 2026-09-06 found `DATABASE_URL` present and no `SUPABASE_DB_URL`; no secrets were changed. |

## Names that are not external dependencies

`supabaseAdmin` is a compatibility facade: in Neon mode it creates the
Postgres-backed query adapter, not a Supabase network client. Supabase-shaped
query methods, TypeScript types, and `/storage/v1/object/public/...` paths
are retained to avoid an unrelated repository-wide rename. The explicit
legacy backend still needs the Supabase SDK, so removing the packages is a
separate compatibility decision.

Historical migrations, the optional user-configured Supabase MCP connection,
and agent templates about working on Supabase repositories are not Mogplex
runtime dependencies. This audit does not delete them or migrate external
users' projects.

## Regression gate

Playwright now builds and runs in Neon mode with Supabase variables explicitly
empty, overriding local files and CI placeholder credentials. This makes an
accidental legacy client initialization observable instead of silently passing.
The runtime spec exercises Control and retired auth links; storage tests run
real SQL against disposable Postgres. No production credentials or customer
records are needed for the local regression suite.

This is a code-path audit, not proof of all production environment values or
data-copy completeness. An authenticated production browser check is still
required after deployment.
