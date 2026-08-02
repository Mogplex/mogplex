# Slice 06: Tool Inventory and Sandbox Authorization

Status: Proposed

## Owner

Tool and sandbox authorization agent.

## Goal

Gate all AI tools and direct sandbox operations through explicit capability checks.

## Write Scope

- `lib/agents/tools.ts`
- `lib/team-tool-policy.ts`
- `lib/sandbox/route-context.ts`
- Direct sandbox route handlers under `app/api/sandbox/**`
- Connection creation/OAuth routes
- Tool inventory tests and sandbox route tests

## Tool Inventory

Create a static inventory table in `lib/team-tool-policy.ts` that classifies every tool returned by `buildStaticTools` and dynamic connection tools:

| Tool | Capability | Notes |
| --- | --- | --- |
| `bash` | `tools.bash` | Auto-starts sandbox; execution-capable |
| `write_file` | `tools.write_file` | Sandbox file mutation |
| `web_search` | `tools.web_search` | External search |
| `web_fetch` | `tools.web_search` | External fetch/read |
| `virtual_exec` | `tools.virtual_exec` | Local text execution |
| `read_file`, `list_files` | `tools.github_read` | GitHub read access |
| `github_api` | `tools.github_read` unless write methods are added | Current implementation is read-oriented; split before write support |
| `start_sandbox` | `tools.bash` | Creates execution environment |
| `stop_sandbox` | `tools.bash` | Lifecycle mutation |
| `add_memory` | `tools.memory_write` | Persistent memory write |
| `search_memories`, `list_memories` | no destructive capability | Still team-scoped by resource ownership |
| `browse_skills`, `browse_vercel_docs` | no destructive capability | Read-only helpers |
| dynamic REST/MCP tools | `tools.connection_runtime` | Per-connection finer ACL can be a follow-up |

Tests must fail when `buildStaticTools` adds a tool missing from the inventory.

## Sandbox Route Authorization

Add one central helper used by direct sandbox routes:

```ts
authorizeSandboxOperation({
  userId,
  productTeamId,
  sandboxRecordId,
  operation,
});
```

Operations:

- `launch`
- `exec`
- `terminal.connect`
- `file.read`
- `file.write`
- `tree.read`
- `tree.mutate`
- `harness.run`
- `restart`
- `resume`
- `stop`
- `extend`
- `delete`

Minimum mapping:

- `launch`, `exec`, `terminal.connect`, `harness.run`, `restart`, `resume` require `tools.bash`.
- `file.write` and `tree.mutate` require `tools.write_file`.
- `stop`, `extend`, `delete` require `tools.bash` for v1.
- Read operations require valid resource membership but no destructive capability.

## Billing Subject

In team context, sandbox launch must persist:

- `product_team_id`
- `actor_user_id`
- `billing_subject`: `personal_vercel`, `platform`, `team_deferred`, or future value

Until real team billing is implemented, team-context sandbox launch must either use an explicit personal/platform billing subject already available to the actor or return `TEAM_BILLING_NOT_CONFIGURED`. Do not silently bill another member.

## Acceptance Criteria

- Tool registry filters only through the inventory.
- Direct sandbox routes cannot bypass team capability checks.
- Team-context sandbox launches record team id, actor id, and billing subject.
- Invalid team context returns 403 before Vercel Sandbox SDK calls.
- Existing personal sandbox behavior is unchanged.

## Tests

- Unit: inventory covers every static tool.
- Unit: owner/admin/developer/viewer tool registry results.
- Unit: direct route authorization for exec, file write, tree mutation, terminal, harness, restart/resume/stop.
- Unit: team billing-not-configured path denies before SDK call.

## Handoff

UI slices should consume denied-state codes from this helper rather than duplicating policy.
