# AGENTS.md

This is the single orientation guide for all coding agents working in `mogplex`. `CLAUDE.md` redirects here.

## Baseline Coding Agent Behavior

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them; don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No flexibility or configurability that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't improve adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it; don't delete it.

When your changes create orphans:

- Remove imports, variables, or functions that your changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" -> "Write tests for invalid inputs, then make them pass"
- "Fix the bug" -> "Write a test that reproduces it, then make it pass"
- "Refactor X" -> "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```text
1. [Step] -> verify: [check]
2. [Step] -> verify: [check]
3. [Step] -> verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## Repo Overview

Mogplex is a Next.js 16 App Router application for running AI-agent workflows against user repos. **Status:** MVP (started 2026-03-15).

- multi-pane workspace UI for chat, files, editor, terminal, preview, and observability
- GitHub and Vercel integrations for repo access, auth, and sandbox billing
- Supabase for auth, Postgres, and server-side state
- Vercel Sandbox for per-repo preview environments
- Trigger.dev and internal cron/API fallback routes for background automation
- GitHub Actions owns production deploys: `main` first applies Supabase migrations, then deploys to Vercel
- Vercel Git deployments are disabled for `main`; branch previews still use the Git integration
- Production deploys end with a machine-auth smoke check against the repo/workspace data surfaces most sensitive to schema drift

## Tech Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript** (strict mode)
- **Tailwind CSS v4** (`@tailwindcss/postcss`, styles in `app/globals.css`)
- **shadcn/ui** (new-york style, RSC enabled) — 57+ components in `components/ui/`
- **Supabase** for auth (GitHub OAuth), database (Postgres + RLS), and edge functions
- **Vercel AI SDK** (`ai` v6) for streaming chat with multi-provider model support
- **Zustand** for client state management
- **Vercel Sandbox SDK** (`@vercel/sandbox`) for isolated microVM code execution per user
- **xterm.js** + **Monaco Editor** for terminal and code editor panes (dynamically imported)
- `next.config.mjs` has `ignoreBuildErrors: false` — builds fail on TypeScript errors

## Architecture Map

- `app/` — App Router pages and layouts; `app/api/*` for auth, repos, sandbox, observability, flows, settings, cron
- `components/` — UI surfaces; `components/panes/*` major product surfaces; `components/ui/*` shared primitives
- `hooks/` — client state, data hooks, and Zustand stores (despite `use-*` naming)
- `lib/` — domain logic; notable: `lib/sandbox`, `lib/observability`, `lib/activation`, `lib/flows`, `lib/supabase`
- `tests/unit/` — 127+ test files using `tsx --test` (Node built-in runner)
- `tests/e2e/` — 20+ Playwright specs (Chromium)
- `supabase/migrations/` — source of truth for schema evolution
- `trigger/` — Trigger.dev jobs and scheduled maintenance tasks

## Auth

Triple auth system:

1. **Supabase Auth** (primary) — GitHub OAuth for user login
2. **GitHub App** (`mogplex`) — repo access, webhooks, agent operations (`lib/github-app.ts`)
3. **Vercel OAuth** (secondary) — stores `vercel_token` in `profiles`

`proxy.ts` refreshes Supabase sessions on all routes. Supabase clients: `lib/supabase/server.ts` (server), `lib/supabase/client.ts` (browser).

## Pane System

Recursive split-pane layout in `hooks/use-split-panes.ts`. Pane types: `agent`, `terminal`, `editor`, `files`, `preview`, `tools`, `stats`, `memories`, `rules`, `skills`, `roster`, `output`, `cron`, `diff`. Rendered by `components/pane-content.tsx`.

## Sandbox System

- `lib/sandbox/client.ts` — SDK wrapper; `createSandboxForRepo()` bills to the user's Vercel account
- `hooks/use-sandbox.ts` — Zustand store for sandbox lifecycle (launch, stop, refresh)
- `hooks/use-pty-transport.ts` — PTY transport state machine (session, retry, stream, resize)
- Sandbox creation: clone repo → install deps → start dev server → return preview URL
- Stop/restart: snapshots running sandbox before stopping to preserve user work; restarts restore from snapshot
- Cost safety: `sandbox-reaper` cron stops idle/expired VMs; `last_active_at` tracked on exec/file/health ops

## Temporary Billing Posture

Pricing, billing, packaging, and team cost attribution will be finalized over the next few weeks. Until then, Mogplex pays for user testing costs for approved/beta users and teams. Do not block team/org feature testing solely because final billing is not implemented yet. Keep cost attribution explicit in records where the schema supports it, but treat real team billing, plan enforcement, and paid packaging as deferred product decisions unless a task explicitly asks to implement them.

## Environment Variables

Required: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`, `CRON_SECRET`

GitHub App: `GITHUB_APP_ID`, `GITHUB_APP_NAME`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`

Optional Vercel OAuth: `NEXT_PUBLIC_VERCEL_APP_CLIENT_ID`, `VERCEL_APP_CLIENT_SECRET`

Optional Sentry: `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`. Source-map upload only runs when org, project, and auth token are all set; otherwise the build skips the Sentry wrapper.

Optional memory embeddings: `OPENAI_API_KEY` powers semantic search for memories via `text-embedding-3-small`. Without it, `/api/memories?q=...` falls back to ILIKE. Storage and listing work regardless.

All env vars managed via Vercel. Run `vercel env pull` to sync `.env.local`.

### Memories

Memories live in the `public.memories` Supabase table (`supabase/migrations/20260417121000_memories_table.sql`). The server path in `lib/memories-client.ts` uses the service-role key, which bypasses RLS — **isolation is enforced primarily by explicit `user_id` filters on every query and by the `match_user_id` argument to the `public.match_memories` RPC**. RLS policies (`user_id = public.current_profile_id()`) are defense-in-depth for any direct DB or end-user JWT (anon/authenticated) client access. When adding new server-side queries, always include an `eq('user_id', client.userId)` filter — do not rely on RLS to catch a missing predicate. Lanes: `session`, `semantic`, `episodic`, `procedural`. Vector search via the `public.match_memories` RPC.

For cross-app memory portability (e.g. memories.sh cloud sync with the CLI / other agents), users can add `@memories.sh` as an MCP server through the existing Connection UI — no core dependency required.

## Core Commands

- `pnpm dev` — local dev server
- `pnpm lint` — full ESLint run
- `pnpm typecheck` — `tsc --noEmit`
- `pnpm build` — production build
- `pnpm test:unit` — unit tests
- `pnpm test:e2e` — Playwright
- `pnpm git:cleanup` — prune local branches whose PRs have been merged or closed; run after pulling main
- `pnpm git:cleanup -- --remotes` — audit remote branches too: reports which are fully landed (safe to delete) and which carry commits pushed after their PR merged (orphaned work — do not delete)

## CI Pipeline

GitHub Actions (`ci.yml`) runs **lint**, **typecheck**, **test** (`pnpm test:all`), **build**, and **e2e** on every PR, merge group, and push to `main`; `secret-scan.yml` adds **trufflehog** and `pr-protection.yml` adds **tests-accompany-features** (see TESTING.md). All seven are required checks on `main`. The **e2e** check is a fan-in over four `e2e-shard (n/4)` matrix jobs — the shards do the work; the `e2e` job only aggregates their results, and its name must not change (the ruleset requires that context). Production deploys (`deploy-production.yml`) run Supabase migrations before Vercel deploy, then smoke-check `/api/cron/production-smoke`.

Two advisory (non-required) checks also run on PRs: **diff-coverage** (`pr-protection.yml`) fails when changed `lib/**` lines are under 80% covered by the vitest tier, and **mutation** (`mutation.yml`) runs incremental Stryker over changed `lib/**` files and reports the mutation score without failing on it. A red diff-coverage or a low mutation score means the accompanying tests probably don't pin the behavior — treat it as a TESTING.md "must go red" violation and fix the tests, don't ignore it because the merge isn't blocked.

### Merge through the merge queue

`main` uses a merge queue (squash merges): land PRs with **"Merge when ready"** (`gh pr merge --auto --squash`), and the queue tests each PR against the projected state of `main` in a merge group before merging. Queued PRs build speculatively in parallel (up to 5), so several green PRs merge in roughly one pipeline's latency.

What this changes:

- Open PRs no longer re-run CI when another PR merges — the strict up-to-date requirement is gone; the queue owns serialization.
- Stacking several open PRs is fine. Keep each PR small and single-concern for review, not for CI cost.
- A required check that never reports on `merge_group` stalls the queue: any new workflow carrying a required check must include the `merge_group:` trigger. Enforced structurally by `scripts/check-merge-group-triggers.mjs` (runs in the lint job): every workflow triggering on `pull_request` must also trigger on `merge_group` or carry an allowlist entry with a reason.
- Queue failures evict the PR and rebuild everything behind it, so flaky tests are more expensive in the queue than on PRs — fix or quarantine flakes promptly (TESTING.md).
- Each CI run forks an ephemeral Neon branch (`ci-run-<run_id>-<attempt>`) for e2e, so speculative builds are isolated from each other; the `neon-branch-cleanup` job deletes it. Requires the `NEON_API_KEY` secret + `NEON_PROJECT_ID` repo variable — when absent, e2e falls back to the shared live database (with a workflow warning) and concurrent queue builds can interfere; then, if queue-only flakes appear, suspect test isolation before infrastructure.

Corollary that still applies: batch review fixes. If a reviewer leaves three findings, address all of them in one push, not three.

### Migrations: never apply schema changes out of band

**Do NOT apply migrations to production via the Supabase MCP `apply_migration` tool, the Supabase dashboard SQL editor's migration feature, or any path that writes a row to `supabase_migrations.schema_migrations`.** The `deploy-production` workflow gates every deploy on `supabase db push --include-all`, which **aborts** ("Remote migration versions not found in local migrations directory") whenever the remote history contains a version with no matching file in `supabase/migrations/`. One orphaned version row freezes ALL production deploys — silently, since `main` does not auto-deploy — until the ledger is reconciled. (This happened Jun 2026: a migration applied via MCP as `20260617143344` vs. the committed `20260617120000_*.sql` blocked five merged PRs from shipping for four days.)

To change the schema:

- **Always commit a file** to `supabase/migrations/` and let `deploy-production.yml` apply it via `supabase db push`. The repo is the source of truth — the migration ledger must only ever be advanced by that push.
- For ad-hoc/one-off prod SQL (backfills, an `ALTER FUNCTION`, data fixes), use the MCP `execute_sql` tool, which does **not** record a version row. If the change is schema-shaped and should persist, also commit a migration file for it.
- Keep migration files pipeline-compatible (no `CREATE INDEX CONCURRENTLY` — it cannot run in `db push`'s extended-query pipeline) and idempotent (`IF NOT EXISTS`, guarded `UPDATE`s).

If deploys are already broken by an orphaned version, reconcile the ledger (repoint the row to the committed version preserving `name`/`statements`, or add the matching repo file) — never just `migration repair --status reverted` and forget it, since that drops tracking of a real applied change. Then re-run `deploy-production` (it accepts `workflow_dispatch`).

## Hook and Check Setup

- Husky is enabled through `pnpm prepare`
- `.husky/pre-commit` runs `pnpm exec lint-staged`
- staged `*.ts` / `*.tsx` files run:
  - `pnpm exec eslint --fix`
  - `pnpm exec tsc --noEmit --pretty false`
- `.husky/pre-push` runs:
  - `pnpm lint`
  - `pnpm typecheck`

Agents should still run focused checks for touched areas before finishing work. The hooks are a safety net, not the only verification step.

### Format with `eslint --fix`. Never run the Prettier CLI on `.tsx`

Formatting is enforced by ESLint's `prettier/prettier` rule, which `ultracite/eslint/core` turns on — that rule is what `lint-staged`, `pnpm lint`, and CI run. `prettier.config.mjs` (re-exporting `ultracite/prettier`) supplies the options, so the standalone CLI and the ESLint rule agree on *style*.

They do not agree on *coverage*. The ultracite block that enables the rule is scoped to:

```js
files: ["**/*.js", "**/*.ts", "**/*.json", "**/*.mjs", "**/*.cjs", "**/*.html"]
```

`**/*.tsx` and `**/*.jsx` are not in that list, so **no formatter runs on React component files.** Verified 2026-07-27:

| | fails `prettier --check` |
|---|---|
| `.ts` under `components/`, `lib/`, `app/` | **0 of 531** |
| `.tsx` under the same paths | **194 of 217** |

The `.ts` column is zero because the rule really is enforced there. The `.tsx` column is 89% because nothing enforces it — that is real drift against the repo's own declared config, not the CLI disagreeing.

The practical consequence: running `prettier --write` on a `.tsx` reformats a file no gate has ever touched, and CI accepts it, because no job runs the CLI. On `components/panes/flows-pane.tsx` that rewrites ~12,500 lines of an 8,100-line file and buries the actual change in the diff.

So: format with `pnpm exec eslint --fix <paths>`, matching what the hooks run. Do not reach for the Prettier CLI to tidy a component. If a diff comes back far larger than the edit you made, check `git diff --stat` before committing.

Closing the gap properly means adding `**/*.tsx` to that rule's `files` **and** reformatting all 194 files in one dedicated commit. That is a deliberate change with a large diff, not something to fold into an unrelated PR.

## Type Standards

These are the repo’s expected TypeScript rules and conventions.

### Compiler Baseline

- TypeScript runs in `strict` mode
- `pnpm typecheck` must pass for completed work
- use the `@/*` path alias for repo-root imports
- prefer ESM syntax and `import type` for type-only imports

### Type Design

- Prefer `type` aliases by default
- Use `interface` only when you need declaration merging or a clear extension contract
- Prefer string literal unions over `enum`
- Model UI and workflow states as discriminated unions or literal unions when possible
- Keep shared product/domain types in feature-local modules or `lib/types.ts`; avoid duplicating wire shapes across components

### `any`, `unknown`, and boundaries

- Do not introduce `any` unless there is a real boundary you cannot model yet
- Prefer `unknown` at untyped boundaries, then narrow
- When external data enters from:
  - route handlers
  - webhooks
  - third-party APIs
  - browser storage validate or narrow before use
- If `any` is unavoidable, keep it tightly scoped and document why

### Nullability and optional fields

- Use `undefined` for omitted optional values in app code
- Use `null` only when the backing API, DB record, or external contract actually distinguishes `null`
- Mirror Supabase row shapes exactly at the data boundary, then adapt them into clearer UI/domain shapes when useful

### React and component typing

- Type component props explicitly
- Prefer narrow props over passing large bag objects
- Keep derived display state in helpers/presenters rather than spreading boolean conditionals through JSX
- When a component needs a reusable state contract, extract the type beside the feature instead of recreating it inline in multiple files

### Server and API typing

- Type request/response payloads close to the route or feature that owns them
- Reuse shared payload types only when more than one caller actually depends on the same contract
- For server-side presenter helpers, return explicit typed objects rather than partially shaped records

### Tests

[TESTING.md](./TESTING.md) is the binding testing policy — required coverage
per change class, what counts as a real test, and the public/private test
boundary. The rules agents most often need:

- Keep test fixtures typed
- Prefer small builder helpers for repeated fixture shapes
- When fixing a regression, add a test that would have failed before the fix
- Before finalizing a new test, break the change under test and confirm the
  test fails; a test that has never gone red proves nothing
- Migrations and trigger changes require a `tests/db/` case; user-visible
  behavior changes require an e2e regression spec
- A behavior-changing PR with no test changes must say why with a `No-tests:`
  line in its description (the `pr-protection` workflow blocks it otherwise)
- Mocking internal modules fails lint (`testing/no-internal-mocks`); mockable
  boundaries are declared in `tests/support/mockable-boundaries.mjs`
- Public correctness tests live in this repo and must run (or self-skip
  cleanly) without hosted-service secrets; release-qualification evals,
  thresholds, and baselines for the hosted service are private and never go
  here

## Working Style for Agents

- Source files are capped at 500 lines — split by concern instead of growing a file. Enforced by the ESLint `max-lines` rule; pre-existing violators are grandfathered to warnings in a shrink-only list in `eslint.config.mjs` (remove entries as files get refactored down, never add new ones). Giant files also pin ESLint's per-file worker parallelism and break the Prettier CLI (see the flows-pane hazard below)
- Make behavior-level changes before refactors
- Keep feature-specific helpers local to the feature until reuse is real
- Follow existing repo conventions before introducing new abstractions
- Do not rely on `next build` alone for correctness; run explicit lint/type/test coverage for the touched area
- Before committing, pushing, or opening a PR, ensure your branch is up to date with its remote base and resolve drift first; do not publish work from a stale branch
- Once a branch's PR is merged, that branch is finished. Never push follow-up commits to it — not review fixes, not "one more thing", not docs. Those commits land nowhere: the PR is closed, so nothing re-reviews or re-merges them, and the branch lingers on the remote looking stale while actually holding the only copy of that work. Start a new branch off fresh `main` and open a new PR instead. This is the single most common way work has been silently lost in this repo; as of 2026-07-26, eleven remote branches each carried exactly one such orphaned commit
- Do not delete a remote branch whose tip does not match its merged PR head — that gap is unpublished work. Verify with `pnpm git:cleanup -- --remotes` before pruning anything on the remote
- New scheduled maintenance work should prefer Trigger.dev; keep `/api/cron/*` routes as authenticated manual fallbacks unless there is a concrete reason to schedule on Vercel instead
- Use the repo `pnpm trigger:*` scripts rather than raw Trigger CLI when running or deploying Trigger tasks; they load `.env.local` and normalize the platform Vercel env aliases the Trigger config expects
- Production migrations merged to `main` must stay backward-compatible with the currently deployed app until the schema-first deploy workflow finishes
- Shared platform AI and platform sandbox credentials are allowlisted resources, not default user entitlements. Use `PLATFORM_ACCESS_USER_IDS` / `PLATFORM_ACCESS_EMAILS` / `PLATFORM_ACCESS_EMAIL_DOMAINS` for bootstrap access and `profiles.allow_platform_ai` / `profiles.allow_platform_sandbox` for durable per-user grants
- Do NOT introduce artificial user-facing limits (concurrency caps, rate limits, quotas, queue caps, throttles) without explicit approval from Charles. If a safety backstop is genuinely needed, propose it with the concrete failure mode it prevents and wait for sign-off; never silently pick a limit value. Limits that predate this rule remain only until reviewed; each one is defined (what it counts, where enforced, symptom when hit, whether work is delayed or dropped) in the doc comment on `AUTOMATION_LIMITS` in `lib/workflows/automation-guardrails.ts` — `maxRunningPerInstallation` is active, the two pending-queue caps are dormant (no production caller). The per-repo running limit was removed 2026-07-06 at Charles's request

### Flow run UI refactors

- Treat `lib/flows/run-presentation.ts` as the single source of truth for run action visibility and run-status presentation in the recent-runs rail and details modal
- Preserve backend-derived run flags (`cancelable`, `repairable`, `requeueable`) when refactoring UI logic; do not collapse state combinations locally
- Update the `tests/unit/flow-run-presentation-*.test.ts` suites before changing run-control logic so the presenter contract stays explicit
- Add or update one user-visible regression test in the `tests/e2e/flows-pane-runs-*.spec.ts` suites when changing rail or modal run-control behavior
- Treat review findings as blocking only when they point to an actual invariant break, failing scenario, or user-visible regression; otherwise keep them as advisory cleanup
