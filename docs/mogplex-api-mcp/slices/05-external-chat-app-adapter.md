# Slice 05: External Chat App Adapter

## Owner

External chat integration agent.

## Goal

Wire another chat app to Mogplex through either the MCP server or the raw `/api/v1/mogplex/*` HTTP API.

This slice lives primarily in the other chat app, but the contract and expectations are documented here so the integration does not drift.

## Write Scope

In the chat app:

- MCP server registration/config.
- Tool permission policy.
- UI surfaces for run links and status.
- Optional background refresh for run status/events.

In Mogplex:

- integration contract doc at `docs/mogplex-api-mcp/external-chat-app-integration.md`,
- live smoke script at `pnpm mcp:smoke`,
- only small API contract fixes found while integrating.

## Recommended Integration

Use MCP if the chat app already has MCP tool support.

Use raw HTTP if the app needs custom UI, background event refresh, or tighter control over credential storage.

Do not call internal Mogplex sandbox or observability routes directly from the chat app. Treat `/api/v1/mogplex/*` as the only supported external HTTP contract.

Hosted MCP endpoint:

```txt
POST https://<mogplex-host>/api/v1/mogplex/mcp
Authorization: Bearer mog_...
Accept: application/json, text/event-stream
```

Live smoke:

```bash
MOGPLEX_API_TOKEN=mog_... MOGPLEX_MCP_URL=https://<mogplex-host>/api/v1/mogplex/mcp pnpm mcp:smoke
```

## Credential Handling

Store a user-provided Mogplex PAT:

```txt
mog_...
```

Rules:

- Store encrypted at rest.
- Never send to the LLM as prompt text.
- Only attach it to HTTP requests or MCP process environment.
- Provide a simple reconnect path when Mogplex returns `UNAUTHORIZED`.

## User Flow

1. User connects Mogplex in the chat app settings.
2. Chat app verifies the token by calling `mogplex_list_repos` or `GET /api/v1/mogplex/repos`.
3. User asks for repo work.
4. Model selects a repo id or asks the user to choose.
5. Model/tool starts a Mogplex run with a prompt and branch policy.
6. Chat app displays run id, branch, status, and a link back to Mogplex.
7. Chat app fetches events until terminal.
8. User can cancel from the chat app.

## UX Requirements

Every started run should display:

- repo full name,
- working branch,
- harness,
- status,
- created time,
- link to Mogplex run/sandbox when available,
- cancel action while pending or streaming.

The chat transcript should not dump raw logs by default. Show a compact status summary and make full events expandable.

## Prompting Guidance

When invoking `mogplex_start_agent_run`, the chat agent should include:

- concrete task request,
- expected output,
- target branch behavior,
- files or modules in scope,
- validation commands if known,
- whether a PR should be opened or only code should be pushed.

Avoid vague prompts like "work on this repo." Mogplex agents run better with an explicit success condition.

## Polling and Events

Preferred pattern:

- Fetch run state after start.
- Fetch events on user-visible refresh or while the run panel is open.
- Stop refreshing when status is terminal.

If the chat app supports background jobs or subscriptions, it may refresh more frequently, but do not create unbounded polling loops.

## Acceptance Criteria

- User can connect a Mogplex token.
- User can list/select repos.
- User can start a Mogplex run from chat.
- User can inspect status/events from chat.
- User can cancel a running Mogplex run.
- The chat app never receives or displays Mogplex internal secrets.

## Tests

- Token validation success/failure.
- Tool permission prompt or allowlist behavior.
- Start run happy path.
- Run status rendering for pending, streaming, success, failed, cancelled.
- Cancel action.
- Redaction check for event payload display.

## Handoff

Slice 07 should validate:

- no secret leakage in chat logs,
- bounded event display,
- clean UX for failed auth and missing repo access.
