# Local Agent Automation over MCP

Local Codex, Claude Code, and other MCP clients can operate Mogplex through one OAuth-enabled streamable HTTP endpoint:

```txt
https://mogplex.com/api/v1/mogplex/mcp
```

OAuth 2.1 authorization code flow with PKCE is the preferred authentication method. Tokens are issued by Mogplex's Supabase Auth server and are accepted only when their issuer, signature, expiry, approved client id, and MCP resource audience all validate.

## Install in Codex

Register the hosted endpoint and bind OAuth to the exact MCP resource:

```bash
codex mcp add mogplex \
  --url https://mogplex.com/api/v1/mogplex/mcp \
  --oauth-resource https://mogplex.com/api/v1/mogplex/mcp
codex mcp login mogplex
```

Codex opens the Mogplex consent page. Sign in, review the requested access, then choose **Allow access**. Restart Codex if the new tool catalog does not appear in an already-running session.

The equivalent `~/.codex/config.toml` entry is:

```toml
[mcp_servers.mogplex]
url = "https://mogplex.com/api/v1/mogplex/mcp"
oauth_resource = "https://mogplex.com/api/v1/mogplex/mcp"
```

For clients without OAuth support, create a key in Mogplex Settings > Mogplex Keys and send `Authorization: Bearer mog_...`. A read-only token can discover repos, agents, models, automations, runs, and logs. Creating sandboxes or changing/running automations requires `write`. Keep PATs in the client's secret or environment configuration; never paste them into a prompt.

## Tool workflow

For an existing automation:

1. Call `mogplex_list_automations` for bounded, graph-free summaries. Pass its `nextCursor` back as `cursor` to continue, and use `mogplex_get_automation` when you need one automation's full draft and published graphs.
2. Call `mogplex_list_models` before choosing a model id.
3. Use `mogplex_set_automation_model` for a narrow node-level change, or `mogplex_update_automation` to replace the complete draft graph.
4. Call `mogplex_publish_automation` to validate, version, and activate a draft.
5. Call `mogplex_trigger_automation` with an automation id, a repo id, and an optional event-shaped input object.
6. Read progress and diagnostics with `mogplex_list_automation_runs` and `mogplex_get_automation_run_logs`.

For a new automation:

1. Call `mogplex_list_repos`; each repo includes `installation_id`.
2. Call `mogplex_list_agents`; graph agent nodes accept returned real ids and `preset:*` ids.
3. Call `mogplex_create_automation`. Without a graph, Mogplex creates a simple Start -> Agent -> End draft using the user's first agent when available.
4. Supply a complete Flow graph through `mogplex_update_automation`, then publish it.

The graph contract is the same as the Flow editor: `nodes`, `edges`, and a valid optional `viewport`. Create and update reject malformed graphs before touching the draft. Exactly one start and end node and at least one bound agent node are required at publish time.

## Sandbox workflow

- `mogplex_create_sandbox` creates or reuses a repo/branch sandbox. It consumes the existing launch event stream and returns after a ready record or failure; it does not poll status.
- `mogplex_list_sandboxes` returns current and recent records.
- `mogplex_get_sandbox_logs` returns install logs, dev-server logs, the current error, and persisted lifecycle events.

## Manual trigger input

`mogplex_trigger_automation.input` is merged into the run metadata before Mogplex adds authoritative repo, installation, flow, version, and source fields. For a GitHub-oriented flow, pass the same fields its conditions and agent prompt expect, for example:

```json
{
  "automationId": "flow-uuid",
  "repoId": "repo-uuid",
  "idempotencyKey": "local-tool-call-123",
  "input": {
    "pull_request": { "number": 42, "title": "Fix checkout" },
    "sender": { "login": "octocat" }
  }
}
```

Mutation calls use one-shot requests. Run history is append-only, and clients should read it on demand; the MCP implementation does not introduce status polling.

## Smoke test

With the local app running:

```bash
MOGPLEX_API_TOKEN=mog_... MOGPLEX_API_URL=http://127.0.0.1:3000 pnpm mcp:smoke
```

The smoke initializes MCP, lists the full tool catalog, and verifies repo access.
