# Self-Hosting Mogplex

Mogplex is built to be self-hosted. The code in this repository is exactly what runs [mogplex.com](https://mogplex.com); the hosted product is a convenience, not a different edition. The Apache-2.0 license has no fee, no seat limit, and no gated features.

Two deployment shapes are supported:

1. **Containers.** Pull the published multi-arch image (`ghcr.io/mogplex/mogplex`, amd64 and arm64) and run it with Docker Compose, Kubernetes, or any platform that runs OCI images, on any cloud or your own hardware. You provision the backing services yourself.
2. **Vercel.** Fork the repo and import it into your own Vercel team. This is how mogplex.com runs.

Self-hosting is community-supported. There is no SLA, but questions in [GitHub Discussions](https://github.com/Mogplex/mogplex/discussions) and bugs filed as [issues](https://github.com/Mogplex/mogplex/issues) are welcome, and friction in the self-hosting path is treated as a bug worth fixing.

## What the Docker image contains

One image runs the web app, the migration runner, and the cron scheduler. `docker compose up` also starts Postgres 17 with pgvector. The job runner (Trigger.dev), sandbox runtime, GitHub App, and model providers are external services, so configure the services below to unlock agent work.

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

## Give users access

Platform AI and sandboxes are gated per user. On mogplex.com that gate is a funded billing account. A self-hosted deployment without Stripe has no balances, so set `MOGPLEX_SELF_HOSTED=1`. It grants platform AI and sandbox access to every signed-in user and hides the billing screens. To limit the grant, set `MOGPLEX_SELF_HOSTED_ALLOWED_EMAIL_DOMAINS=example.com`. Self-host mode never activates while `STRIPE_SECRET_KEY` is set. For finer control, use the `PLATFORM_ACCESS_*` allowlists or the `profiles.allow_platform_*` flags. Full guide: [docs.mogplex.com/self-hosting](https://docs.mogplex.com/self-hosting).

## Run with Docker Compose

```bash
curl -fsSLO https://raw.githubusercontent.com/Mogplex/mogplex/main/docker-compose.yml
curl -fsSL https://raw.githubusercontent.com/Mogplex/mogplex/main/.env.example -o .env
# edit .env: set APP_URL, BETTER_AUTH_SECRET, CRON_SECRET, and the services you provisioned

docker compose up -d   # postgres, migrate (one-shot), app on :3000, cron
```

This pulls `ghcr.io/mogplex/mogplex:latest`. Pin a release with `MOGPLEX_VERSION=v0.2.0` in `.env`, and upgrade by changing it and running `docker compose up -d` again; `migrate` applies any new migrations before the new `app` starts. Set `MOGPLEX_PORT` to serve on a host port other than 3000.

| Service | What it does |
| --- | --- |
| `postgres` | Postgres 17 with pgvector. It runs because `.env.example` sets `COMPOSE_PROFILES=postgres`. Set `POSTGRES_PASSWORD` in `.env` to change the default password. To use an external database instead, set `DATABASE_URL` and `DATABASE_URL_UNPOOLED` in `.env` and remove `COMPOSE_PROFILES`; then no local Postgres starts. |
| `migrate` | Runs `node scripts/migrate.cjs`: applies `neon/baseline.sql` and `neon/migrations/`, then exits. `app` starts only after it succeeds. |
| `app` | The web app. Its health check calls `GET /api/health`, which returns 503 when the database is unreachable. |
| `cron` | Runs `node scripts/self-host-cron.mjs`: calls each cron route in `vercel.json` on its schedule with `Authorization: Bearer $CRON_SECRET`. |

The app reads its public URL from `APP_URL` at runtime, so one image serves any domain. Other `NEXT_PUBLIC_*` values (Sentry DSN, consent backend, Vercel sign-in client ID, legacy Supabase keys) are inlined into the client bundle **at build time**, so the published image leaves them unset. To set them, or to run unreleased code, build from a checkout:

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

Without compose, run the same image three ways:

```bash
docker run --rm --env-file .env ghcr.io/mogplex/mogplex node scripts/migrate.cjs
docker run -d --env-file .env -p 3000:3000 ghcr.io/mogplex/mogplex
docker run -d -e CRON_SECRET -e CRON_TARGET_URL=https://mogplex.example.com ghcr.io/mogplex/mogplex node scripts/self-host-cron.mjs
```

CI boots this compose stack on both architectures for every change to the image (`.github/workflows/self-host-smoke.yml`). To run the same check locally: `docker build -t mogplex:local . && MOGPLEX_IMAGE=mogplex MOGPLEX_VERSION=local node scripts/self-host-smoke.mjs`.

## GitHub App setup

[`github-app-manifest.json`](../github-app-manifest.json) lists the permissions, events, and URLs the App needs. To create the App from it, sign in to your deployment and open `/admin/setup/github` while `GITHUB_APP_*` is unset. Outside production it is always available; in production, set `MOGPLEX_SETUP_ENABLED=1` first and remove it after setup. GitHub creates the App on your account or organization and returns to `/admin/setup/github/complete`, which shows `GITHUB_APP_ID`, `GITHUB_APP_NAME`, `GITHUB_APP_PRIVATE_KEY`, and `GITHUB_WEBHOOK_SECRET` once. Mogplex does not store them. Copy them into your environment and Trigger.dev, then redeploy.

Repository import also needs `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` from a classic GitHub OAuth App with the callback URL `https://<your-domain>/api/auth/github/callback`. The App's own client credentials do not work there: that flow requests OAuth scopes, and App user tokens expire.

Mogplex can create a remediation PR when GitHub reports a new Dependabot alert.
GitHub continues to detect vulnerable dependencies.
See [Dependabot remediation](./dependabot-remediation.md) for permissions, setup, and run behavior.

## Slack app setup

Create the app from [`slack-app-manifest.yml`](../slack-app-manifest.yml): open [api.slack.com/apps](https://api.slack.com/apps), choose **Create New App → From a manifest**, and replace `mogplex.example.com` with your domain. A unit test keeps its bot scopes equal to the scopes the install flow requests. The details below describe what the manifest configures.

Set the Slack OAuth redirect URL to `https://<your-domain>/api/integrations/slack/callback`. The bot OAuth flow requests these scopes: `app_mentions:read`, `channels:history`, `channels:read`, `chat:write`, `files:read`, `groups:history`, `groups:read`, `im:history`, `im:read`, `mpim:history`, `mpim:read`, `users:read`, and `users:read.email`.

`files:read` lets Mogplex download images attached to thread messages. Existing workspace installations must reconnect after upgrading to a release that adds this scope; changing the application code cannot expand an existing Slack OAuth grant.

Register a Slack slash command named `/mogplex` with the request URL `https://<your-domain>/api/webhooks/slack`, and grant the bot the `commands` OAuth scope. Existing workspace installations must reconnect after this scope is added. Linked users can run `/mogplex model` to see their current and available models, or `/mogplex model <model-id>` to change the model used for their next eligible response. The selection applies only to that Slack user in that channel, including its threads; it does not change another participant's selection. A run already in progress keeps the model it started with. If a saved model later becomes unavailable to that user or team, Mogplex falls back to the conversation or account default instead of attempting the unavailable model.

## Self-hosted Trigger.dev

Mogplex's background jobs run on Trigger.dev. You can use Trigger.dev Cloud or run the open-source Trigger.dev v4 stack yourself. Nothing in Mogplex changes between the two; only the URL and keys do.

1. **Run Trigger.dev.** Follow [Trigger.dev self-hosting](https://trigger.dev/docs/self-hosting/overview) (Docker Compose or Kubernetes). The stack includes the webapp, Postgres, Redis, ClickHouse, object storage, a container registry, and supervisor/worker nodes. Workers need outbound access to your Mogplex deployment and to the services your tasks call.
2. **Create a project** in your Trigger.dev webapp. Copy its project ref and the production secret key.
3. **Configure Mogplex** in the app environment and in `.env.local` for CLI use:

   ```bash
   TRIGGER_API_URL=https://trigger.example.com   # your Trigger.dev webapp URL
   TRIGGER_PROJECT_REF=proj_...
   TRIGGER_SECRET_KEY=tr_prod_...
   ```

   The Trigger.dev SDK reads `TRIGGER_API_URL`, so every task the app starts goes to your instance. Always set `TRIGGER_PROJECT_REF`; `trigger.config.ts` falls back to the hosted Mogplex project when it is unset.
4. **Log in the CLI** against your instance: `pnpm exec tsx scripts/trigger-cli.ts login`. In CI, set `TRIGGER_ACCESS_TOKEN` to a personal access token from your instance instead.
5. **Deploy the tasks** with `pnpm trigger:deploy`. When `TRIGGER_API_URL` is set, the wrapper passes `--api-url` to the Trigger.dev CLI for `deploy`, `dev`, `login`, and the other commands that accept it. An explicit `--api-url` argument wins.

   A self-hosted instance without a remote build server builds the worker image on your machine, so the deploy machine needs Docker with `buildx`, and it must be logged in (`docker login`) to the container registry your Trigger.dev instance pulls from. Pass extra CLI flags after `--`, for example `pnpm trigger:deploy -- --local-build`.
6. **Give the tasks their environment.** Tasks import the same server code as the app, so copy the app's server variables (database URLs, AI keys, `CRON_SECRET`, GitHub and Slack credentials) into the project's environment variables in your Trigger.dev webapp. Vercel env sync runs only when a Vercel token and project ID are present, so a non-Vercel deploy skips it.

For local task development against your instance, run `pnpm trigger:dev` with the same variables.

## Self-hosted models (OpenAI-compatible endpoint)

Air-gapped or cost-sensitive deployments can serve models from their own endpoint instead of AI Gateway or provider keys. Any server that implements the OpenAI chat completions API works, for example [LiteLLM](https://docs.litellm.ai/), [vLLM](https://docs.vllm.ai/), or [Ollama](https://ollama.com/).

```bash
MOGPLEX_OPENAI_COMPATIBLE_BASE_URL=http://litellm:4000/v1   # the URL that ends before /chat/completions
MOGPLEX_OPENAI_COMPATIBLE_API_KEY=sk-...                    # optional; omit for servers without auth
MOGPLEX_OPENAI_COMPATIBLE_MODELS=llama3.1:8b=Llama 3.1 8B,qwen2.5-coder
```

- Each listed model appears in the model pickers as `openai-compatible/<id>` for every user. The text after `=` is the display name. Users can still turn a model off in **Settings → Models**, and team model allowlists accept these ids.
- Requests go straight to your endpoint, never through AI Gateway, and do not need platform AI access. Mogplex sends only `MOGPLEX_OPENAI_COMPATIBLE_API_KEY` to the endpoint, never the platform `OPENAI_API_KEY`.
- The endpoint has no pricing data, so usage is recorded without a cost, like direct provider keys.
- Scope: the native Mogplex agent and chat surfaces. The Claude Code and Codex harnesses keep their own model access.
- Set the same variables in Trigger.dev so automation runs can use these models.

## Operating it

- **Check the setup.** Run `pnpm setup:doctor` after you set the environment, and again after each upgrade. It reports each service as pass, warn, or fail, never prints secret values, and links to the guide that fixes each problem. Add `--live` to also validate the Trigger.dev and Vercel credentials against their APIs. It exits non-zero when a check fails, so it also works as a deploy gate.
- **Migrations.** The image never touches your schema. Run `pnpm exec tsx scripts/apply-neon-migrations.ts` with `DATABASE_URL` exported (or pass `--env-file=.env`) before first boot and after each upgrade. On an empty database it applies `neon/baseline.sql` first, then any pending files from `neon/migrations/`, and records what ran. Run it as the database owner: it creates schemas, the `vector` and `pg_trgm` extensions, and the `service_role` and `supabase_auth_admin` roles that the row-level-security policies reference. (Legacy Supabase installations use `supabase/migrations/` instead.)
- **Trigger deploys.** Trigger.dev tasks in `trigger/` deploy separately with `pnpm trigger:deploy` against your own Trigger project. For a self-hosted Trigger.dev instance, see [Self-hosted Trigger.dev](#self-hosted-triggerdev).
- **TLS, domains, OAuth callbacks.** Every OAuth integration (GitHub, Vercel, Slack, MCP clients) needs your deployment URL registered on your own apps, with exact-match redirect/resource URLs.
- **Secrets.** Generate random values for `CRON_SECRET`, `INTERNAL_API_SECRET`, `CONNECTIONS_ENCRYPTION_KEY`, and `EMAIL_UNSUBSCRIBE_SECRET`, and store them in your platform secret store.
- **Upgrades.** Pull `main` or a tagged release, apply migrations, redeploy. Release notes on the [releases page](https://github.com/Mogplex/mogplex/releases) call out breaking env or migration changes.

## Known constraints

- The sandbox terminal bridge reads `lib/sandbox/terminal-bridge-runtime.mjs` from disk at runtime; standalone output tracing normally carries it, but the sandbox feature set as a whole requires Vercel Sandbox regardless.
- Cron routes (`vercel.json`) are scheduled by Vercel. With Docker Compose, the `cron` service schedules them. Elsewhere, run `node scripts/self-host-cron.mjs` with `CRON_SECRET` and `CRON_TARGET_URL`, or call the routes from your own cron with `Authorization: Bearer $CRON_SECRET`.
- Sandboxes require Vercel Sandbox today. A pluggable sandbox backend is a natural contribution if you need to run compute elsewhere; open a discussion before starting so the interface lands in one piece.
