# Mogplex API and MCP Integration Plan

Status: Implemented and expanded for local automation control
Date: 2026-04-27
Scope: External API and MCP surface that lets another chat application launch, observe, and cancel Mogplex agent runs.

## Summary

Build an external integration layer for Mogplex in two steps:

1. Add a stable authenticated HTTP API for external callers.
2. Ship an MCP server that is a thin wrapper over that HTTP API.

The MCP server should not reimplement sandbox, Git, database, or harness logic. Mogplex remains the execution system. External chat apps call Mogplex through the API, and MCP tools call the same API.

## Product Goal

Let another chat app safely delegate repo-bound work to Mogplex agents. A user should be able to say "run Mogplex on this repo task" from the other app and receive:

- a stable Mogplex run id,
- a linked sandbox and branch,
- streamed or pollable run events,
- final status and result metadata,
- cancellation control,
- traceability back to the repo, sandbox, harness, and AI call.

## Current Primitives To Reuse

- API key auth: `lib/auth/api-key.ts`
- PAT route allowlist: `lib/auth-route-policy.ts`
- Middleware/proxy auth delegation: `proxy.ts`
- Sandbox launch/reuse: `app/api/sandbox/route.ts`
- Sandbox harness execution: `app/api/sandbox/[id]/harness/route.ts`
- Harness config and runner: `lib/harness/config.ts`, `lib/harness/runner.ts`
- AI call/event persistence: `lib/interactive-runs.ts`
- Observability calls/events: `app/api/observability/calls/route.ts`, `app/api/observability/call-events/route.ts`
- Run cancellation precedent: `app/api/observability/calls/[id]/cancel/route.ts`
- Flow/automation job precedent: `lib/automation-dispatch.ts`, `lib/workflows/automation-job-workflow.ts`
- Multi-agent orchestration foundation: `lib/orchestrations/*`

## Target External API

Initial API namespace:

```txt
GET    /api/v1/mogplex/repos
GET    /api/v1/mogplex/sandboxes
POST   /api/v1/mogplex/runs
GET    /api/v1/mogplex/runs/:runId
GET    /api/v1/mogplex/runs/:runId/events
POST   /api/v1/mogplex/runs/:runId/cancel
POST   /api/v1/mogplex/mcp
```

Auth:

```txt
Authorization: Bearer mog_...
Idempotency-Key: <caller-generated-key>
```

`POST /api/v1/mogplex/runs` starts harness-backed sandbox runs. The API also exposes Flow automation design, publication, manual execution, run diagnostics, model discovery, and explicit sandbox launch/log access. See [Local Agent Automation](./local-agent-automation.md).

## Target MCP Tools

The MCP server exposes workflow-sized tools that map one-to-one to the external API:

```txt
mogplex_list_repos
mogplex_list_sandboxes
mogplex_start_agent_run
mogplex_get_run
mogplex_get_run_events
mogplex_cancel_run
```

The first MCP shipping surface is the hosted Streamable HTTP endpoint at:

```txt
https://<mogplex-host>/api/v1/mogplex/mcp
```

It accepts JSON-RPC MCP requests with the same PAT auth header:

```txt
Authorization: Bearer mog_...
Accept: application/json, text/event-stream
```

See [External Chat App Integration](./external-chat-app-integration.md) for request examples, permission policy, and smoke-test instructions.

The current automation and sandbox extension adds:

```txt
mogplex_list_agents
mogplex_list_models
mogplex_create_sandbox
mogplex_get_sandbox_logs
mogplex_list_automations
mogplex_get_automation
mogplex_create_automation
mogplex_update_automation
mogplex_publish_automation
mogplex_set_automation_model
mogplex_trigger_automation
mogplex_list_automation_runs
mogplex_get_automation_run_logs
```

Later multi-agent orchestration tools:

```txt
mogplex_start_orchestration
mogplex_get_orchestration
mogplex_list_orchestration_tasks
mogplex_approve_orchestration_step
```

## Slice Execution Order

1. [External API Contract and Auth](./slices/01-external-api-contract-and-auth.md) - implemented
2. [Run Lifecycle API](./slices/02-run-lifecycle-api.md)
3. [Run Events and Cancellation](./slices/03-run-events-and-cancellation.md)
4. [MCP Server Wrapper](./slices/04-mcp-server-wrapper.md)
5. [External Chat App Adapter](./slices/05-external-chat-app-adapter.md)
6. [Orchestration Extension](./slices/06-orchestration-extension.md)
7. [Security, Observability, and Verification](./slices/07-security-observability-verification.md)

The first three slices are the minimum useful API. The MCP server can begin once the API contract exists. The external chat adapter can be developed against the MCP tools or the raw HTTP API. The orchestration extension should wait until harness-backed single-agent runs are reliable.

## Core Invariants

- Mogplex owns execution. MCP only delegates and observes.
- A run must be tied to a user, repo, sandbox record, branch, root directory, harness, and AI call.
- External requests must use user-scoped PAT auth, not internal cron or delegated-machine secrets.
- Every mutating start request must accept an idempotency key.
- Run events must be append-only and safe to replay.
- The initial version supports one harness run per API run. Multi-agent orchestration is a separate explicit mode.
- API responses must be structured JSON suitable for both MCP clients and normal HTTP clients.

## Non-Goals

- Do not expose raw database access.
- Do not let an MCP server run Git commands directly against user repos.
- Do not create a second agent execution engine inside the chat app.
- Do not expose internal `CRON_SECRET` or `INTERNAL_API_SECRET` auth to third-party clients.
- Do not make `/api/observability/*` broadly public; use a narrow API namespace for external consumers.

## Suggested Data Model

The first pass can use existing `ai_calls`, `ai_call_events`, and `sandboxes` rows, with API-run metadata stored on `ai_calls.metadata`.

Suggested metadata fields:

```json
{
  "source": "external-api",
  "external_request_id": "caller-key-or-run-id",
  "harness_id": "codex",
  "sandbox_record_id": "uuid",
  "sandbox_id": "vercel-sandbox-name",
  "repo_id": "uuid",
  "repo": "owner/name",
  "base_branch": "main",
  "working_branch": "mogplex/external-run-...",
  "root_directory": null
}
```

If the API needs a stable run id that is not an `ai_call.id`, add a small `external_agent_runs` table before the API leaves draft status.

## Verification Baseline

- Unit tests for auth allowlist behavior.
- Route tests for every `/api/v1/mogplex/*` handler.
- Contract tests for MCP tool input/output schemas.
- Cancellation tests that prove the API updates existing control state rather than inventing a parallel cancel path.
- One smoke test that starts a mocked run and can read events through the public API namespace.
