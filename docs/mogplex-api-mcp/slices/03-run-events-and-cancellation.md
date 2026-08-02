# Slice 03: Run Events and Cancellation

## Owner

Run observability agent.

## Goal

Expose external-safe run detail, event history, and cancellation for runs started through `/api/v1/mogplex/runs`.

## Write Scope

- `app/api/v1/mogplex/runs/[runId]/route.ts`
- `app/api/v1/mogplex/runs/[runId]/events/route.ts`
- `app/api/v1/mogplex/runs/[runId]/cancel/route.ts`
- `lib/mogplex-api/runs/**`
- route tests for event and cancel behavior

Do not change internal observability routes unless extracting shared presenter helpers.

## Run Detail

`GET /api/v1/mogplex/runs/:runId` returns:

```ts
type MogplexRunDetail = {
  runId: string;
  aiCallId: string;
  status: "pending" | "streaming" | "success" | "failed" | "cancelled";
  type: "agent";
  model: string;
  repoId: string | null;
  sandboxRecordId: string | null;
  sandboxId: string | null;
  harness: string | null;
  branch: {
    base: string | null;
    working: string | null;
  };
  rootDirectory: string | null;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  metadata: Record<string, unknown>;
};
```

Only expose metadata that is safe for an external client. Never return provider keys, GitHub tokens, Vercel tokens, raw environment variables, or internal secrets.

## Events

`GET /api/v1/mogplex/runs/:runId/events` returns a paginated event list:

```ts
type MogplexRunEvent = {
  id: string;
  runId: string;
  type: string;
  level?: "debug" | "info" | "warn" | "error";
  message: string;
  toolName: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
};
```

Query parameters:

```txt
?limit=100&after=<event-id-or-created-at>
```

Keep default `limit` modest. Cap at 500.

## Cancellation

`POST /api/v1/mogplex/runs/:runId/cancel`

Rules:

- Reuse the existing AI call cancellation/control-state path.
- Do not invent a second cancellation table.
- Return the updated run detail.
- If the run is already terminal, return success with the existing terminal state.
- If the run is not owned by the user, return 404.

## Event Sanitization

The external event presenter must sanitize:

- full environment variable maps,
- secret-looking values,
- full command output beyond a bounded limit,
- internal stack traces unless the user needs them for their own run.

Use existing telemetry sanitization helpers where possible.

## Acceptance Criteria

- External clients can fetch current run state by id.
- External clients can page through run events by id.
- Cancellation uses the same control state the harness already checks.
- Terminal runs are idempotently cancel-safe.
- Events do not expose secrets or unbounded logs.

## Tests

- Run detail success, 404 not owned, 404 missing.
- Event list pagination and limit cap.
- Event payload sanitization.
- Cancel pending run.
- Cancel streaming run.
- Cancel terminal run returns current state.

## Handoff

Slice 04 depends on:

- Stable schemas for run detail and run events.
- Cancellation endpoint returning consistent structured JSON.
- Error codes documented for not found, unauthorized, and already terminal states.
