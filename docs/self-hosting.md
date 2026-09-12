# Self-Hosting Mogplex

Mogplex is built to be self-hosted. The code in this repository is exactly what runs [mogplex.com](https://mogplex.com); the hosted product is a convenience, not a different edition. The Apache-2.0 license has no fee, no seat limit, and no gated features.

Two deployment shapes are supported:

1. **Vercel (recommended).** Fork the repo, import it into your own Vercel team, point it at your own Neon project and Trigger.dev project, and set the environment variables below. This is the path we test in production every day.
2. **Docker.** Build the image in this repo and run it anywhere that can run a container. You provision the backing services yourself.

Self-hosting is community-supported. There is no SLA, but questions in [GitHub Discussions](https://github.com/Mogplex/mogplex/discussions) and bugs filed as [issues](https://github.com/Mogplex/mogplex/issues) are welcome, and friction in the self-hosting path is treated as a bug worth fixing.

## What the Docker image contains

The Next.js web application. The database, auth, job runner, and sandbox runtime are external services (the same ones the Vercel deployment uses), so `docker compose up` gives you a web server that needs the services below configured before it is useful.

## What you need to provide

Each row is independent. Mogplex boots with only the first row configured; every other row unlocks a feature area when you add it.

| Service | What it does | Your options |
| --- | --- | --- |
| **Postgres + auth** (required) | All application state and user accounts | [Neon](https://neon.tech) or any Postgres 17 with the `vector` and `pg_trgm` extensions available, with Better Auth. Set both backend flags to `neon`, configure `DATABASE_URL` / `DATABASE_URL_UNPOOLED` and `BETTER_AUTH_SECRET`, add at least one sign-in provider (`AUTH_GITHUB_*`, `AUTH_GOOGLE_*`, or email), and run the migration script below. It bootstraps an empty database from `neon/baseline.sql` and then applies `neon/migrations/`. |
| **Trigger.dev** | Background jobs: automations, syncs, long-running agent runs | A [Trigger.dev cloud](https://trigger.dev) account with your own project (`TRIGGER_PROJECT_REF`, `TRIGGER_SECRET_KEY`), or [self-host the full Trigger.dev stack](https://trigger.dev/docs/self-hosting/overview) — webapp, Postgres, Redis, ClickHouse, object storage, container registry, and supervisor/worker nodes. Without it, everything Trigger-powered does not run. |
| **Vercel (sandboxes)** | Agent sandboxes run on [Vercel Sandbox](https://vercel.com/docs/vercel-sandbox) | A Vercel account and token (`PLATFORM_VERCEL_TOKEN`, `PLATFORM_VERCEL_TEAM_ID`, `VERCEL_PROJECT_ID`). There is no local substitute; without it, sandbox features are dead. |
| **AI providers** | Model inference, memory embeddings | [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) key and/or OpenRouter + OpenAI keys. |
| **GitHub App** | Repo access, webhooks, checks | You create and operate your own GitHub App and point its webhook at your deployment. |
| **Email (Resend)** | Waitlist and transactional email | A [Resend](https://resend.com) account, or accept degraded log-only fallbacks. |
| **Sentry** (optional) | Error tracking | Your own Sentry org/project. |
| **Slack app** (optional) | Slack integration | Your own multi-workspace Slack app. |

Every one of these has its own signup, billing, and credential rotation. Budget an afternoon for a full setup; the app shell alone takes a few minutes.

## Build

`NEXT_PUBLIC_*` values are inlined into the client bundle **at build time**. You cannot set them when the container starts — you bake them in with build args and rebuild whenever they change.

```bash
cp .env.example .env   # fill in everything you provisioned above

docker compose build   # reads the NEXT_PUBLIC_* values from .env
docker compose up -d
```

Or without compose:

```bash
docker build \
  --build-arg NEXT_PUBLIC_APP_URL=https://mogplex.example.com \
  --build-arg NEXT_PUBLIC_MOGPLEX_DATA_BACKEND=neon \
  -t mogplex .

docker run --env-file .env -p 3000:3000 mogplex
```

## GitHub App setup

Mogplex can create a remediation PR when GitHub reports a new Dependabot alert.
GitHub continues to detect vulnerable dependencies.
See [Dependabot remediation](./dependabot-remediation.md) for permissions, setup, and run behavior.

## Slack app setup

Set the Slack OAuth redirect URL to `https://<your-domain>/api/integrations/slack/callback`. The bot OAuth flow requests these scopes: `app_mentions:read`, `channels:history`, `channels:read`, `chat:write`, `files:read`, `groups:history`, `groups:read`, `im:history`, `im:read`, `mpim:history`, `mpim:read`, `users:read`, and `users:read.email`.

`files:read` lets Mogplex download images attached to thread messages. Existing workspace installations must reconnect after upgrading to a release that adds this scope; changing the application code cannot expand an existing Slack OAuth grant.

Register a Slack slash command named `/mogplex` with the request URL `https://<your-domain>/api/webhooks/slack`, and grant the bot the `commands` OAuth scope. Existing workspace installations must reconnect after this scope is added. Linked users can run `/mogplex model` to see their current and available models, or `/mogplex model <model-id>` to change the model used for their next eligible response. The selection applies only to that Slack user in that channel, including its threads; it does not change another participant's selection. A run already in progress keeps the model it started with. If a saved model later becomes unavailable to that user or team, Mogplex falls back to the conversation or account default instead of attempting the unavailable model.

## Operating it

- **Migrations.** The image never touches your schema. Run `pnpm exec tsx scripts/apply-neon-migrations.ts` with `DATABASE_URL` exported (or pass `--env-file=.env`) before first boot and after each upgrade. On an empty database it applies `neon/baseline.sql` first, then any pending files from `neon/migrations/`, and records what ran. Run it as the database owner: it creates schemas, the `vector` and `pg_trgm` extensions, and the `service_role` and `supabase_auth_admin` roles that the row-level-security policies reference. (Legacy Supabase installations use `supabase/migrations/` instead.)
- **Trigger deploys.** Trigger.dev tasks in `trigger/` deploy separately with `pnpm trigger:deploy` against your own Trigger project.
- **TLS, domains, OAuth callbacks.** Every OAuth integration (GitHub, Vercel, Slack, MCP clients) needs your deployment URL registered on your own apps, with exact-match redirect/resource URLs.
- **Secrets.** Generate random values for `CRON_SECRET`, `INTERNAL_API_SECRET`, `CONNECTIONS_ENCRYPTION_KEY`, and `EMAIL_UNSUBSCRIBE_SECRET`, and store them in your platform secret store.
- **Upgrades.** Pull `main` or a tagged release, apply migrations, redeploy. Release notes on the [releases page](https://github.com/Mogplex/mogplex/releases) call out breaking env or migration changes.

## Known constraints

- The sandbox terminal bridge reads `lib/sandbox/terminal-bridge-runtime.mjs` from disk at runtime; standalone output tracing normally carries it, but the sandbox feature set as a whole requires Vercel Sandbox regardless.
- Cron routes (`vercel.json`) are scheduled by Vercel. Self-hosting means scheduling them yourself (curl + your `CRON_SECRET` from your own cron).
- Sandboxes require Vercel Sandbox today. A pluggable sandbox backend is a natural contribution if you need to run compute elsewhere; open a discussion before starting so the interface lands in one piece.
