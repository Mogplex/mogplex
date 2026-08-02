# Slice 02: Run Lifecycle API

## Owner

Run lifecycle agent.

## Goal

Implement `POST /api/v1/mogplex/runs` and `GET /api/v1/mogplex/runs/:runId` for single-agent harness-backed Mogplex runs.

The endpoint should launch or reuse a sandbox, start a harness run, and return a stable run handle that external clients can observe.

## Write Scope

- `app/api/v1/mogplex/runs/route.ts`
- `app/api/v1/mogplex/runs/[runId]/route.ts`
- `lib/mogplex-api/runs/**`
- route tests for the new endpoints

Touch `app/api/sandbox/route.ts` or `app/api/sandbox/[id]/harness/route.ts` only to extract reusable helpers if absolutely necessary. Prefer wrapping existing routes/services without changing browser behavior.

## Request Shape

```ts
type StartMogplexRunRequest = {
  repoId: string;
  prompt: string;
  harness?: "codex" | "claude-code";
  baseBranch?: string | null;
  workingBranch?: string | null;
  createBranch?: boolean;
  rootDirectory?: string | null;
  conversationId?: string | null;
  workspaceSessionId?: string | null;
  mode?: string | null;
};
```

Defaults:

- `harness`: `codex`
- `baseBranch`: repo default branch or `main`
- `workingBranch`: if omitted and `createBranch` is true, generate `mogplex/external/<short-id>`
- `createBranch`: true when generated working branch differs from base branch
- `rootDirectory`: omit to use repo default; explicit null means repo root

## Response Shape

```ts
type StartMogplexRunResponse = {
  ok: true;
  data: {
    runId: string;
    aiCallId: string;
    sandboxRecordId: string;
    sandboxId: string | null;
    repoId: string;
    harness: "codex" | "claude-code";
    status: "pending" | "streaming" | "success" | "failed" | "cancelled";
    branch: {
      base: string;
      working: string;
    };
    rootDirectory: string | null;
    eventsUrl: string;
    cancelUrl: string;
  };
};
```

`runId` can initially equal `aiCallId` if the contract documents that. If that feels too limiting, add an external run row before shipping public clients.

## Lifecycle

1. Validate PAT user and request body.
2. Require `Idempotency-Key`.
3. Resolve owned repo and branch/root settings.
4. Launch or reuse sandbox through the same semantics as `POST /api/sandbox`.
5. Start harness execution through the same semantics as `POST /api/sandbox/[id]/harness`.
6. Stamp `ai_calls.metadata.source = "external-api"` and include branch/root/sandbox details.
7. Return immediately after the harness run is accepted, with run ids and URLs.

## Streaming Decision

Initial version should be non-streaming for `POST /runs`: accept work and return identifiers. Use `GET /runs/:runId/events` for observation.

Reason: MCP tools work better with bounded tool calls than long-lived SSE streams. The chat app can still poll or subscribe using the events endpoint.

## Idempotency

Keyed by:

```txt
user_id + idempotency_key + endpoint
```

If the same key is replayed with the same normalized request, return the original run. If the same key is replayed with a different request, return `409 IDEMPOTENCY_CONFLICT`.

Acceptable first pass:

- Store idempotency data in a small table.
- Or store it in a dedicated external run table if that table is introduced.

Do not rely on in-memory maps.

## Acceptance Criteria

- A valid PAT can start a single Codex harness run against an owned repo.
- The response includes `runId`, `aiCallId`, `sandboxRecordId`, branch identity, and event/cancel URLs.
- Replaying the same idempotency key does not start a duplicate run.
- Request validation rejects missing `repoId`, empty prompt, invalid harness, invalid branch, and invalid root directory.
- Browser-facing sandbox and harness behavior is unchanged.

## Tests

- Route test for successful start with mocked sandbox/harness service.
- Route test for idempotent replay.
- Route test for idempotency conflict.
- Route tests for unauthorized and not-owned repo.
- Route tests for request validation.

## Handoff

Slice 03 depends on:

- Stable run id.
- Run metadata containing `source`, `repo_id`, `sandbox_record_id`, `harness_id`, branch, and root directory.
- Route helper to load a run owned by the current PAT user.
