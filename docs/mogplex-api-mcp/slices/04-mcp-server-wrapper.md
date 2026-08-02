# Slice 04: MCP Server Wrapper

## Owner

MCP wrapper agent.

## Goal

Build an MCP server that lets external chat apps call Mogplex through well-described tools. The server delegates to `/api/v1/mogplex/*` and contains no direct sandbox, Git, or database logic.

## Write Scope

First implementation:

- hosted Streamable HTTP endpoint at `POST /api/v1/mogplex/mcp`,
- shared HTTP API client under `lib/mogplex-api/client.ts`,
- MCP JSON-RPC/tool wrapper under `lib/mogplex-api/mcp.ts`,
- focused unit tests for the client, tools, and route.

Future stdio packaging can still use the same API client and tool definitions:

- new package under `packages/mogplex-mcp-server/`, or
- a small standalone app under `mcp-server/`.

Also allowed:

- shared generated or hand-written API client under the MCP package,
- tests for tool schemas and API client behavior,
- README for installation and configuration.

Do not edit Mogplex web route handlers in this slice except for contract drift discovered during integration.

## Transport

First shipped transport:

- Streamable HTTP-compatible JSON-RPC at `/api/v1/mogplex/mcp`.

Follow-up transport:

- stdio for local desktop/CLI clients, reusing the same tool handlers and API client.

The hosted endpoint is stateless and does not allocate MCP session ids. It returns one JSON-RPC response per POST request, and returns HTTP 405 for GET because it does not expose a server-to-client SSE stream yet.

The endpoint supports:

- `initialize`
- `ping`
- `tools/list`
- `tools/call`
- `notifications/initialized` and other notifications as accepted no-body responses

Use:

```txt
Authorization: Bearer mog_...
Accept: application/json, text/event-stream
```

For browser-origin callers, set `MOGPLEX_MCP_ALLOWED_ORIGINS` to a comma-separated list of allowed origins. Server-to-server calls normally omit `Origin`.

## Configuration

Environment variables:

```txt
MOGPLEX_API_URL=https://app.mogplex.com # optional override for hosted endpoint self-calls
MOGPLEX_MCP_ALLOWED_ORIGINS=https://chat.example.com
```

Standalone stdio package follow-up:

```txt
MOGPLEX_API_URL=https://app.mogplex.com
MOGPLEX_API_TOKEN=mog_...
MOGPLEX_REQUEST_TIMEOUT_MS=30000
MOGPLEX_DEFAULT_HARNESS=codex
```

Never accept provider model keys in the MCP server. Model and harness credentials stay in Mogplex.

## Tools

### `mogplex_list_repos`

Lists repos available to the authenticated Mogplex user.

Inputs:

```ts
{
  query?: string;
  limit?: number;
}
```

### `mogplex_list_sandboxes`

Lists active or recent Mogplex sandboxes.

Inputs:

```ts
{
  repoId?: string;
  status?: string;
  limit?: number;
}
```

### `mogplex_start_agent_run`

Starts a harness-backed Mogplex agent run.

Inputs:

```ts
{
  repoId: string;
  prompt: string;
  harness?: "codex" | "claude-code";
  baseBranch?: string;
  workingBranch?: string;
  createBranch?: boolean;
  rootDirectory?: string | null;
  idempotencyKey?: string;
}
```

If `idempotencyKey` is omitted, the MCP server may generate one per tool call. If the calling chat app already has a stable message/tool-call id, pass that through.

### `mogplex_get_run`

Gets current run state.

Inputs:

```ts
{
  runId: string;
}
```

### `mogplex_get_run_events`

Gets recent run events.

Inputs:

```ts
{
  runId: string;
  limit?: number;
}
```

### `mogplex_cancel_run`

Requests cancellation.

Inputs:

```ts
{
  runId: string;
}
```

## Tool Output

Return both:

- concise text summary for model readability,
- structured JSON content for clients that can render state.

Example text:

```txt
Started Mogplex run run_123 on owner/repo branch mogplex/external/run-123. Status: pending.
```

## Error Handling

Map API errors into MCP-friendly errors with next steps:

- `UNAUTHORIZED`: "Check MOGPLEX_API_TOKEN."
- `REPO_NOT_FOUND`: "List repos and pass one of the returned repo ids."
- `IDEMPOTENCY_CONFLICT`: "Retry with a new idempotency key or reuse the original request."
- `RUN_NOT_FOUND`: "The run id is missing or belongs to another Mogplex user."

## Acceptance Criteria

- Hosted MCP endpoint can list repos with a valid token.
- Hosted MCP endpoint can start a run and return the API run id.
- Hosted MCP endpoint can fetch run detail and events.
- Hosted MCP endpoint can cancel a run.
- Tool schemas are descriptive enough for an LLM to choose the right tool without extra instructions.
- MCP endpoint does not call sandbox, Git, or database helpers directly; tool execution flows through the external API client.

## Tests

- API client unit tests with mocked fetch.
- Tool schema/list tests.
- Happy path tool tests.
- Error mapping tests.
- Authenticated route tests.
- Local inspector/manual smoke instructions in the package README or follow-up stdio package README.

## Handoff

Slice 05 depends on:

- MCP server package install command.
- Example MCP client config.
- Tool names and input schemas frozen enough for the chat app adapter.
