# Slice 03: Team Context Propagation

Status: Proposed

## Owner

Auth/context propagation agent.

## Goal

Create one reliable way to carry active team context through browser requests, CLI/PAT requests, internal delegated calls, background jobs, Slack-triggered runs, external API/MCP runs, cache keys, and tests.

This slice must land before model, tool, sandbox, or UI enforcement.

## Write Scope

- `lib/auth.ts`
- `app/api/auth/user/route.ts`
- `hooks/use-user.ts`
- `lib/internal-api-auth.ts`
- Context helpers under `lib/team-context.ts`
- E2E auth helpers that need active-team headers or fixtures
- Focused tests in `tests/unit/*team-context*`, `tests/unit/auth-user-route.test.ts`, and route-policy tests if headers are added

Do not enforce model/tool/sandbox permissions in this slice.

## Context Contract

Use `productTeamId` in TypeScript and request contracts.

Sources, in priority order:

1. Explicit request header `x-mogplex-team-id` for browser/API requests where the user selected a team.
2. Explicit body/query team id only for route-local admin operations where the route path already scopes a team.
3. Stored `profiles.active_team_id`.
4. No team source means personal mode.

Resolution output must use Slice 01's discriminated result:

```ts
type TeamContextResolution =
  | { mode: "personal" }
  | { mode: "team"; context: TeamContext }
  | { mode: "invalid"; code: string };
```

Invalid requested or stored team context returns 403. Do not silently fall back to personal mode.

## Auth Payloads

Extend resolved auth for app code:

```ts
type ResolvedAuth = {
  profileId: string;
  authUserId: string | null;
  source: "supabase" | "playwright" | "api-key";
  team: TeamContextResolution;
};
```

`/api/auth/user` should return:

- `teams`: current user's team summaries.
- `active_team`: active team context when valid.
- `team_context_error`: stable code when stored team is invalid.
- Existing `platform_access` unchanged.

## Propagation Surfaces

Cover:

- Browser `fetch` helpers and SWR keys for `/api/models`, `/api/settings`, chat, sandbox, connections, and team APIs.
- CLI/PAT routes, especially `/api/models` and `/api/cli/inference/chat/completions`.
- Internal delegated auth headers used by external API/MCP run execution.
- Slack-triggered `runChatAgent` calls.
- Trigger.dev automation jobs and flow runs.
- Playwright auth bypass helpers.

For background jobs, persist `product_team_id` on the job/run record at enqueue time. Workers must not read a user's current active team later and apply it to an old run.

## Acceptance Criteria

- Personal mode is explicit when no team is requested or stored.
- Invalid/stale stored team produces a stable 403 for team-sensitive routes and a visible `team_context_error` in `/api/auth/user`.
- Team id is present in cache keys where model/tool/sandbox availability changes.
- Background run records carry the team id chosen at enqueue time.
- Existing personal-mode tests keep passing.

## Tests

- Unit: requested valid team, requested non-member team, stale stored team, no team.
- Unit: `/api/auth/user` payload includes teams and active-team error state.
- Unit: CLI/PAT request can carry team context without browser cookies.
- Unit: background enqueue stores `product_team_id`.
- E2E helper test or smoke route proving team header changes active context.

## Handoff

Slices 04 through 10 must call the context helper from this slice and must not invent a second active-team mechanism.
