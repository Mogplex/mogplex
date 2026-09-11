# Contributing to Mogplex

Thanks for contributing.

This guide is for people sending code, docs, design, test, or infrastructure changes into the repo.

## Before You Start

- Not sure where something belongs, or want to talk through an idea first? Use [GitHub Discussions](https://github.com/Mogplex/mogplex/discussions).
- Small bug fixes, docs fixes, and targeted cleanup can go straight to a pull request.
- For larger features, architecture changes, or workflow changes, open an issue first so scope and direction are clear before implementation starts.
- If you believe you found a security issue, do **not** file a public issue. Use [SECURITY.md](./SECURITY.md).

## Local Setup

### Prerequisites

- Node.js `20+`
- `pnpm`
- A Postgres database. [Neon](https://neon.tech) is what CI and production use; any local Postgres 15+ works for development.
- Optional, depending on what you are working on:
  - GitHub OAuth app credentials for sign-in (Google or email sign-in also work)
  - GitHub App credentials for repo import and webhooks
  - A Vercel token for sandbox and preview work
  - An AI Gateway or provider key for model calls
  - Trigger.dev access for background job development

### Install

```bash
pnpm install
```

### Configure envs

Copy [.env.example](./.env.example) to `.env.local`, or pull from Vercel if that is how you work locally:

```bash
cp .env.example .env.local
```

```bash
vercel link
vercel env pull
```

The minimum env set for a normal app boot is:

- `MOGPLEX_DATA_BACKEND=neon` and `NEXT_PUBLIC_MOGPLEX_DATA_BACKEND=neon`
- `DATABASE_URL` and `DATABASE_URL_UNPOOLED`
- `BETTER_AUTH_SECRET`
- `AUTH_GITHUB_CLIENT_ID` and `AUTH_GITHUB_CLIENT_SECRET` (or another sign-in provider)
- `NEXT_PUBLIC_APP_URL`
- `CRON_SECRET`
- `INTERNAL_API_SECRET`
- `CONNECTIONS_ENCRYPTION_KEY`

The optional sections in [.env.example](./.env.example) cover GitHub App, Vercel sandbox, AI providers, Trigger.dev, Slack, billing, and observability.

### Apply database migrations

Apply the checked-in migrations before testing auth, repos, workspaces, or automations:

```bash
pnpm exec tsx scripts/apply-neon-migrations.ts
```

Schema changes go in `neon/migrations/` as timestamped `.sql` files. The `supabase/` directory is a legacy backend kept for existing installations; do not add new migrations there.

### Start the app

```bash
pnpm dev
```

## Main Commands

```bash
pnpm dev
pnpm build
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:e2e
pnpm git:cleanup
pnpm trigger:dev
pnpm trigger:deploy
```

Focused test commands are usually faster than full-suite runs while iterating:

```bash
pnpm exec tsx --test tests/unit/some-file.test.ts
pnpm exec playwright test tests/e2e/some-spec.spec.ts
```

First-time Playwright setup:

```bash
pnpm exec playwright install --with-deps chromium
```

## Verification Expectations

Run the checks that match the surface you changed. [TESTING.md](./TESTING.md) defines which tests a change is required to bring with it and what counts as adequate coverage.

### Typical baseline

```bash
pnpm lint
pnpm typecheck
```

### Add these when relevant

```bash
pnpm build
pnpm test:unit
pnpm test:e2e
```

### Practical guidance by change type

- **Docs-only change**: proofread the rendered markdown and run `git diff --check`
- **UI or hook change**: `pnpm lint`, `pnpm typecheck`, and the relevant unit or e2e coverage
- **API, auth, data, or migration change**: `pnpm lint`, `pnpm typecheck`, `pnpm build`, and targeted regression tests
- **Sandbox, repo, automation, or Trigger work**: run the relevant focused tests and note what could not be verified locally

Hooks and CI are safety nets, not the full bar:

- pre-commit runs `lint-staged`
- pre-push runs full `pnpm lint` and `pnpm typecheck`
- CI runs `lint`, `typecheck`, `test:unit`, and `build`

## Coding Conventions

- TypeScript is strict; avoid `any`
- Prefer `import type` for type-only imports
- Follow existing local patterns before introducing new abstractions
- Keep helpers close to the feature until reuse is real
- Add or update tests for regressions and behavior changes
- Keep behavior changes separate from unrelated refactors

If you are using an AI coding agent in this repo, read [AGENTS.md](./AGENTS.md). That file contains the maintainer-oriented repo map, type standards, and workflow notes the agents are expected to follow.

## Branch and PR Workflow

1. Branch from the latest `main`
2. Keep the change scoped to one feature, fix, or docs concern
3. Before pushing, sync with the remote base and resolve drift first
4. Open a pull request instead of pushing directly to `main`
5. Include the problem, the approach, and the verification you ran
6. Call out migrations, rollout constraints, or integration setup in the PR body

After a PR merges, run:

```bash
pnpm git:cleanup
```

That command returns you to `main`, fast-forwards it, deletes the merged local branch, and prunes local branches whose PRs are safely confirmed as merged.

## Migration Rules

Mogplex deploys production schema before the new application version goes live. That means:

- migrations merged to `main` must remain backward-compatible with the currently deployed app until the production workflow finishes
- schema changes touching auth, access control, repo access, or shared workflow data should come with targeted regression coverage
- if a migration changes contributor setup, update `.env.example`, `README.md`, or this guide in the same PR

## Pull Request Checklist

Before asking for review, make sure your PR:

- explains what changed and why
- stays focused on one concern
- includes verification steps and any known gaps
- notes migration, infra, or secret-setup impact
- avoids shipping generated noise or unrelated refactors

## Security and Secrets

- Never commit `.env.local`, copied production env files, or live provider tokens
- Use `.env.example` as the shareable baseline
- Keep security reports private per [SECURITY.md](./SECURITY.md)

## License

By contributing, you agree that your contributions are licensed under the [Apache License 2.0](./LICENSE).
