# Slice 07: Security, Observability, and Verification

## Owner

Security and verification agent.

## Goal

Make the external API and MCP integration safe to operate. This slice reviews the full feature after slices 01-06 and adds missing guardrails, observability, and verification coverage.

## Write Scope

- tests for `/api/v1/mogplex/*`
- security/redaction helpers if needed
- observability presenters
- API docs updates
- MCP package docs/tests
- rate-limit and request-limit integration if missing

Coordinate before changing route contracts owned by earlier slices.

## Threat Model

External clients can:

- start expensive sandbox/agent work,
- inspect logs and tool events,
- cancel work,
- potentially trigger Git branch creation and PR work.

Primary risks:

- token misuse,
- cross-user data access,
- duplicate expensive runs,
- unbounded logs or event payloads,
- secret leakage through events,
- API namespace accidentally accepting internal machine secrets,
- orchestration fan-out causing unexpected spend.

## Required Guardrails

- PAT-only auth for external API.
- User ownership checks on every repo, sandbox, run, event, and orchestration query.
- Idempotency required for mutating start endpoints.
- Request size limits for prompts.
- Bounded event payload size.
- Secret redaction in event payloads.
- Rate/request limits aligned with existing chat and sandbox boot limits.
- No raw stack traces in public API errors.
- Clear terminal-state behavior for cancellation.

## Observability

Every external run should be searchable by:

- `metadata.source = "external-api"`,
- user id,
- repo id,
- sandbox record id,
- harness id,
- external request id or idempotency key,
- MCP tool caller if provided.

Add dispatch or call events for:

- accepted external request,
- idempotent replay,
- sandbox launch/reuse result,
- harness accepted,
- cancellation requested,
- terminal status.

## API Documentation

Publish docs under `docs/mogplex-api-mcp/` for:

- auth,
- endpoint list,
- request/response examples,
- error codes,
- MCP configuration,
- recommended chat app UX.

Keep examples redacted and runnable.

## Verification Matrix

Auth:

- valid PAT,
- invalid PAT,
- browser session without PAT,
- machine secret on external namespace,
- PAT on machine-auth route.

Run lifecycle:

- start run,
- idempotent replay,
- idempotency conflict,
- repo not owned,
- invalid branch,
- invalid root directory,
- harness unavailable,
- sandbox already running and reused.

Events:

- empty events,
- paginated events,
- terminal event,
- large payload truncation,
- secret-looking payload redaction.

Cancellation:

- pending,
- streaming,
- success,
- failed,
- cancelled,
- not owned.

MCP:

- missing env vars,
- invalid token,
- list repos,
- start run,
- get events,
- cancel run,
- API error mapping.

## Acceptance Criteria

- Full unit/route suite covers external API behavior.
- MCP wrapper has mocked API tests and manual smoke instructions.
- No external endpoint returns cross-user records.
- No external endpoint accepts internal machine secrets as a substitute for user auth.
- Existing browser sandbox/harness flows still pass focused tests.
- Documentation includes exact setup steps for another chat app.

## Suggested Commands

```bash
pnpm exec tsx --test tests/unit/proxy.test.ts
pnpm exec tsx --test tests/unit/*mogplex-api*.test.ts
pnpm typecheck
pnpm lint
```

Add more focused test commands as files are created.
