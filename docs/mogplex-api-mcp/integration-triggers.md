# Integration Triggers

An external system (a server holding a Mogplex API key) can be limited to
starting work only through automations. The automation owns the
instructions, the repositories it may touch, its agents, models and
harnesses, and the inputs it accepts. The integration supplies values for
those inputs and nothing else.

## API key access

Every Mogplex API key (`mog_…`) has an access level, chosen in the app:

| Access | Who chooses | What the key may do |
|---|---|---|
| Full access | The key's owner, in Settings → Mogplex Keys | Whatever its scopes allow: runs, sandboxes, automations, settings |
| Automations only | The key's owner, in Settings → Mogplex Keys | Read, and start work only by triggering an automation with an API trigger |

Keys created before access existed, and keys created through the API without
an `access` field, have Full access. The owner can change a key's access at
any time; the change applies to its next request.

A team owner can also set the team's **Mogplex API keys** setting (team
Settings → Provider Keys) to **Automations only**. Every member's key is then
held to the automation-only rule on that team's repositories, whatever the key
itself allows. Only a team owner can change it, and each change is written to
the team's audit log. Signing in to the app, the CLI's OAuth login and MCP
OAuth clients are not affected by either setting.

A key held to automations gets `403` with code `AUTOMATION_REQUIRED` on a
direct-execution surface, before any run, sandbox, branch or billable request
is created. That covers `POST /api/v1/mogplex/runs`, `POST /api/v1/mogplex/sandboxes`,
the `/api/sandbox` routes, hosted CLI inference, creating, editing, publishing,
retargeting or deleting automations, PR review reruns, repository environment
variables, and writes to account settings and saved MCP servers. The same rules apply through
the MCP endpoint, because each MCP tool calls the API with the caller's
credential. Such a key can trigger only automations with an API trigger.

## Setting up an automation for an integration

1. Create an automation whose start node uses the **API (integrations)** event.
2. Restrict the start node to the repositories the integration may build in.
   A trigger for any other repository is refused with `403 FORBIDDEN`.
3. Declare the inputs under **Inputs (JSON)**. Each field has a `key`
   (lowercase letters, digits and underscores), a `type` (`string`, `integer`,
   `boolean` or `json`), and optionally `required`, `description`, and for
   strings `maxLength`, `pattern` (matched against the whole value) and `enum`,
   or for JSON `maxBytes`.
4. Write the agent's instructions on the automation. Inputs reach the agent as
   JSON data after those instructions, marked as untrusted. An input can't
   replace the instructions, the repository, the branch or the permissions.
5. Publish and enable it.

## Triggering a run

```http
POST /api/v1/mogplex/automations/{automationId}/trigger
Authorization: Bearer mog_…
Idempotency-Key: <stable key for this unit of work>
Content-Type: application/json

{ "repoId": "<repository id>", "input": { "<field>": "<value>" } }
```

`202` returns `data.run`:

```json
{
  "automationId": "…",
  "versionId": "…",
  "versionNumber": 3,
  "jobRunId": "…",
  "workingBranch": "mogplex/automation-0123456789abcdef",
  "outcome": "queued",
  "replayed": false,
  "started": true,
  "status": "running"
}
```

Refusals, all returned before anything is queued:

| Status | Code | Meaning |
|---|---|---|
| 404 | `NOT_FOUND` | The automation or repository doesn't exist or isn't owned by this account |
| 409 | `CONFLICT` | The automation is unpublished or disabled |
| 403 | `AUTOMATION_REQUIRED` | The key is held to automations and this automation has no API trigger |
| 403 | `FORBIDDEN` | The repository is outside the automation's allowed repositories |
| 400 | `BAD_REQUEST` | Input failed validation; the message names each problem, including unknown keys |
| 409 | `IDEMPOTENCY_CONFLICT` | This key was already used with different input |

### Retries

Idempotency keys are scoped to the account and automation. Repeating a key
with the same input returns the original run with `replayed: true` and starts
nothing. Each key maps to one working branch, so a retried unit of work
returns to the same branch. A new build needs a new key.

## Following a run

```txt
GET  /api/v1/mogplex/automations/{automationId}/runs/{jobRunId}
POST /api/v1/mogplex/automations/{automationId}/runs/{jobRunId}/cancel
```

The run detail carries `status`, node runs, AI calls and `metadata`. Its
metadata records `flow_version_id` and `flow_version_number`, `input` (the
accepted snapshot) and its `input_hash`, `working_branch`, and `trigger`
(credential kind, key id and key name). In the app, the same runs appear under
the automation's **Runs** tab, with the version, trigger, input, branch and
links to the transcript and sandbox.

The agent commits and pushes to `workingBranch` and never pushes to the
default branch, merges, or enables auto-merge. It opens a pull request only
when the automation's instructions ask for one. Reading what it built, and
publishing it, stays with the integration's own review step.
