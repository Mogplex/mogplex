# External Chat App Integration

This is the concrete adapter contract for a chat app that wants to launch and observe Mogplex agents.

## Hosted MCP Endpoint

Use the hosted MCP endpoint when the chat app has MCP tool support:

```txt
POST https://<mogplex-host>/api/v1/mogplex/mcp
Authorization: Bearer mog_...
Accept: application/json, text/event-stream
Content-Type: application/json
```

The endpoint is stateless Streamable HTTP-compatible JSON-RPC. It returns JSON responses for client requests and `202 Accepted` for notifications. It does not expose a server-to-client SSE stream yet, so `GET /api/v1/mogplex/mcp` returns `405`.

If the chat app calls from a browser origin, configure Mogplex with:

```txt
MOGPLEX_MCP_ALLOWED_ORIGINS=https://chat.example.com
```

Server-to-server calls normally omit `Origin` and do not need that setting.

## Minimum MCP Flow

Initialize:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-11-25",
    "capabilities": {},
    "clientInfo": {
      "name": "your-chat-app",
      "version": "0.1.0"
    }
  }
}
```

List tools:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list"
}
```

List repos:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "mogplex_list_repos",
    "arguments": {
      "limit": 20
    }
  }
}
```

Start a run:

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "tools/call",
  "params": {
    "name": "mogplex_start_agent_run",
    "arguments": {
      "repoId": "repo-uuid",
      "prompt": "Fix the failing billing test and run pnpm test:unit.",
      "harness": "codex",
      "createBranch": true,
      "idempotencyKey": "chat-message-or-tool-call-id"
    }
  }
}
```

Then call `mogplex_get_run`, `mogplex_get_run_events`, and `mogplex_cancel_run` with the returned `runId`.

For local agents that need to build and operate Flow automations, use the
automation, model, and sandbox tools described in
[Local Agent Automation](./local-agent-automation.md).

## Direct HTTP Alternative

Use the raw HTTP API when the chat app needs custom UI state or its own background job:

```txt
GET    /api/v1/mogplex/repos
GET    /api/v1/mogplex/sandboxes
POST   /api/v1/mogplex/sandboxes
GET    /api/v1/mogplex/sandboxes/:sandboxId/logs
GET    /api/v1/mogplex/agents
GET    /api/v1/mogplex/models
GET    /api/v1/mogplex/automations
POST   /api/v1/mogplex/automations
GET    /api/v1/mogplex/automations/:automationId
PUT    /api/v1/mogplex/automations/:automationId
POST   /api/v1/mogplex/automations/:automationId/publish
PUT    /api/v1/mogplex/automations/:automationId/model
POST   /api/v1/mogplex/automations/:automationId/trigger
GET    /api/v1/mogplex/automations/:automationId/runs
GET    /api/v1/mogplex/automations/:automationId/runs/:runId
POST   /api/v1/mogplex/runs
GET    /api/v1/mogplex/runs/:runId
GET    /api/v1/mogplex/runs/:runId/events
POST   /api/v1/mogplex/runs/:runId/cancel
```

For `POST /api/v1/mogplex/runs`, pass:

```txt
Idempotency-Key: chat-message-or-tool-call-id
```

## Chat App Permission Policy

Recommended defaults:

- Allow `mogplex_list_repos`, `mogplex_list_sandboxes`, `mogplex_get_run`, and `mogplex_get_run_events` without extra confirmation after the user connects Mogplex.
- Require explicit user confirmation for `mogplex_start_agent_run`.
- Require explicit user confirmation for `mogplex_cancel_run` unless the user clicks a first-party cancel button.
- Never expose the PAT to the model as prompt text or tool output.

## Run Display Contract

Render each run with:

- `runId`
- `repoId`
- `harness`
- `status`
- `branch.base`
- `branch.working`
- `branch.createBranch`
- `sandboxRecordId`
- `sandboxId`
- `createdAt`
- `updatedAt`
- `error`

Show a compact event timeline by default. Treat event `payload` as diagnostic data and keep it behind an expandable inspector.

## Validation

Run a live smoke from this repo:

```bash
MOGPLEX_API_TOKEN=mog_... MOGPLEX_MCP_URL=https://<mogplex-host>/api/v1/mogplex/mcp pnpm mcp:smoke
```

For local development:

```bash
MOGPLEX_API_TOKEN=mog_... MOGPLEX_API_URL=http://localhost:3000 pnpm mcp:smoke
```

The smoke initializes MCP, lists tools, and calls `mogplex_list_repos`.
