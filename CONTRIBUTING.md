# Contributing to Mogplex

Thanks for contributing.

This guide is for people sending code, docs, design, test, or infrastructure changes into the repo.

## Before You Start

- Small bug fixes, docs fixes, and targeted cleanup can go straight to a pull request.
- For larger features, architecture changes, or workflow changes, open an issue first so scope and direction are clear before implementation starts.
- If you believe you found a security issue, do **not** file a public issue. Use [SECURITY.md](./SECURITY.md).

## Local Setup

### Prerequisites

- Node.js `20+`
- `pnpm`
- A Supabase project for auth and data-backed flows
- Optional but recommended for full product work:
  - GitHub OAuth configured in Supabase
  - GitHub App credentials
  - Vercel access for sandbox and preview work
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

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_APP_URL`
- `CRON_SECRET`
- `INTERNAL_API_SECRET`
- `CONNECTIONS_ENCRYPTION_KEY`

The optional sections in [.env.example](./.env.example) cover GitHub App, Vercel sandbox, Trigger.dev, memories, and platform AI flows.

### Apply database migrations

If you are using a fresh Supabase project, apply the checked-in migrations before testing auth, repos, workspaces, or automations:

```bash
supabase db push
```

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

Run the checks that match the surface you changed.

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
- schema changes touching auth, RLS, repo access, or shared workflow data should come with targeted regression coverage
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
