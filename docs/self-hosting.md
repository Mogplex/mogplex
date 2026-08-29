# Self-Hosting Mogplex

> **The supported way to use Mogplex is the hosted product at [mogplex.com](https://mogplex.com).** The Apache-2.0 software has no license fee. You need significant time and skill to self-host Mogplex. Mogplex does not support self-hosted deployments or offer an SLA. You must provision, secure, and pay each infrastructure provider directly.

## What the Docker image contains

The Next.js web application. Nothing else.

There is no bundled database, no auth service, no job runner, no sandbox runtime, and no migration tooling in the image. `docker compose up` gives you a web server that will fail loudly until you wire in every backing service below.

## What you must bring

| Service | What it does | Your options |
| --- | --- | --- |
| **Postgres + auth** | All application state and user accounts | A [Supabase](https://supabase.com) project (current), or Postgres such as [Neon](https://neon.tech) once the planned Neon + better-auth migration lands. Either way you provision it, apply every migration in `supabase/migrations/` yourself, and keep it patched. |
| **Trigger.dev** | Background jobs: automations, syncs, long-running agent runs | A [Trigger.dev cloud](https://trigger.dev) account with your own project (`TRIGGER_PROJECT_REF`, `TRIGGER_SECRET_KEY`), or [self-host the full Trigger.dev stack](https://trigger.dev/docs/self-hosting/overview) — webapp, Postgres, Redis, ClickHouse, object storage, container registry, and supervisor/worker nodes. Without it, everything Trigger-powered does not run. |
| **Vercel (sandboxes)** | Agent sandboxes run on [Vercel Sandbox](https://vercel.com/docs/vercel-sandbox) | A Vercel account and token (`PLATFORM_VERCEL_TOKEN`, `PLATFORM_VERCEL_TEAM_ID`, `VERCEL_PROJECT_ID`). There is no local substitute; without it, sandbox features are dead. |
| **AI providers** | Model inference, memory embeddings | [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) key and/or OpenRouter + OpenAI keys. |
| **GitHub App** | Repo access, webhooks, checks | You create and operate your own GitHub App and point its webhook at your deployment. |
| **Email (Resend)** | Waitlist and transactional email | A [Resend](https://resend.com) account, or accept degraded log-only fallbacks. |
| **Sentry** (optional) | Error tracking | Your own Sentry org/project. |
| **Slack app** (optional) | Slack integration | Your own multi-workspace Slack app. |

Every one of these has its own signup, billing, credential rotation, and failure modes. That is the real cost of self-hosting Mogplex.

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
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key \
  -t mogplex .

docker run --env-file .env -p 3000:3000 mogplex
```

## Slack app setup

Set the Slack OAuth redirect URL to `https://<your-domain>/api/integrations/slack/callback`. The bot OAuth flow requests these scopes: `app_mentions:read`, `channels:history`, `channels:read`, `chat:write`, `files:read`, `groups:history`, `groups:read`, `im:history`, `im:read`, `mpim:history`, `mpim:read`, `users:read`, and `users:read.email`.

`files:read` lets Mogplex download images attached to thread messages. Existing workspace installations must reconnect after upgrading to a release that adds this scope; changing the application code cannot expand an existing Slack OAuth grant.

Register a Slack slash command named `/mogplex` with the request URL `https://<your-domain>/api/webhooks/slack`, and grant the bot the `commands` OAuth scope. Existing workspace installations must reconnect after this scope is added. Linked users can run `/mogplex model` to see their current and available models, or `/mogplex model <model-id>` to change the model used for their next eligible response. The selection applies only to that Slack user in that channel, including its threads; it does not change another participant's selection. A run already in progress keeps the model it started with. If a saved model later becomes unavailable to that user or team, Mogplex falls back to the conversation or account default instead of attempting the unavailable model.

## What is still on you after it boots

- **Migrations.** The image never touches your schema. Apply `supabase/migrations/` yourself (`supabase db push --db-url ...`) before first boot and after every upgrade.
- **Trigger deploys.** Trigger.dev tasks in `trigger/` deploy separately (`pnpm trigger:deploy`) against _your_ Trigger project — the image does not do it for you.
- **TLS, domains, OAuth callbacks.** Every OAuth integration (GitHub, Vercel, Slack, MCP clients) needs your deployment URL registered on your own apps, with exact-match redirect/resource URLs.
- **Secrets.** `CRON_SECRET`, `INTERNAL_API_SECRET`, `CONNECTIONS_ENCRYPTION_KEY`, `EMAIL_UNSUBSCRIBE_SECRET` — you mint them, you store them, you rotate them.
- **Upgrades.** No migration notes are published for self-hosters. Read the diff.

## Known constraints

- The sandbox terminal bridge reads `lib/sandbox/terminal-bridge-runtime.mjs` from disk at runtime; standalone output tracing normally carries it, but the sandbox feature set as a whole requires Vercel Sandbox regardless.
- Cron routes (`vercel.json`) are scheduled by Vercel. Self-hosting means scheduling them yourself (curl + your `CRON_SECRET` from your own cron).
- No support channel exists for self-hosted deployments. Issues that cannot be reproduced on the hosted product may be closed.
