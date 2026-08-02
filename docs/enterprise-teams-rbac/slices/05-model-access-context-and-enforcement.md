# Slice 05: Model Access Context and Enforcement

Status: Proposed

## Owner

Model access agent.

## Goal

Create one model access contract and apply it to every model picker and model invocation path.

## Write Scope

- `lib/models/model-access-context.ts`
- `lib/ai-model-resolver.ts`
- `lib/models/default-model.ts`
- `app/api/models/route.ts`
- `app/api/settings/route.ts`
- `app/api/repos/[id]/models/route.ts`
- Invocation entrypoints in chat, CLI inference, agents, flows, automation jobs, Slack runs, and external API/MCP runs
- Focused unit tests for each entrypoint class

## Access Contract

```ts
type ModelAccessContext = {
  userId: string;
  team: TeamContextResolution;
  repoId?: string | null;
  source:
    | "web-chat"
    | "cli"
    | "agent-generate"
    | "flow"
    | "automation"
    | "slack"
    | "external-api";
};
```

Effective model access is the intersection of:

1. Catalog availability and hidden/deprecated filtering.
2. Provider/platform reachability.
3. Personal user model preferences.
4. Repo model overrides where the route already applies them.
5. Team model allowlist when `team.mode === "team"`.

If `team.mode === "invalid"`, deny before provider calls.

## Invocation Coverage

Must cover:

- `resolveUserLanguageModel`.
- `/api/models` web and `format=cli`.
- `/api/settings` default model validation.
- Repo model preference routes.
- `app/api/chat/route.ts` through `createChatModelStream`.
- `app/api/cli/inference/chat/completions/handler.ts`.
- `app/api/agents/generate/route.ts`.
- `lib/flows/api.ts`.
- `lib/workflows/automation-job-workflow.ts`.
- `trigger/slack-event.ts` through `runChatAgent`.
- `lib/mogplex-api/**` external API/MCP execution.

## Error Contract

Stable error codes:

- `TEAM_CONTEXT_INVALID`
- `TEAM_MODEL_NOT_ALLOWED`
- `MODEL_NOT_REACHABLE`
- `MODEL_NOT_ENABLED`

Team allow does not bypass platform or provider-key failures.

## Acceptance Criteria

- Team-denied models are rejected before provider calls.
- Personal mode behavior is unchanged.
- CLI model list respects active team context when supplied.
- Background jobs use the team id stored at enqueue time, not the user's current active team.
- Every direct model invocation path either uses `ModelAccessContext` or is documented as personal-only.

## Tests

- Unit: access intersection ordering.
- Unit: platform deny still denies with team allow.
- Unit: team deny still denies with platform allow.
- Unit: default model falls back to a reachable team-allowed model.
- Unit: CLI, chat, agent generation, flow, automation, Slack, and external API paths pass model context.

## Handoff

Slice 06 should mirror this pattern for tools and sandbox operations.
