# Slice 06: Orchestration Extension

## Owner

Multi-agent orchestration agent.

## Goal

Extend the external API and MCP surface from single harness runs to Mogplex multi-agent Git-tree orchestration.

This should wait until single-agent external runs are reliable.

## Write Scope

- `app/api/v1/mogplex/orchestrations/**`
- `lib/orchestrations/**` only for missing foundation helpers
- orchestration persistence and worker modules when the implementation exists
- orchestration-specific MCP tools
- tests for orchestration API state transitions

Do not overload `/api/v1/mogplex/runs` with multi-agent behavior. Use an explicit orchestration resource.

## Target API

```txt
POST   /api/v1/mogplex/orchestrations
GET    /api/v1/mogplex/orchestrations/:id
GET    /api/v1/mogplex/orchestrations/:id/events
POST   /api/v1/mogplex/orchestrations/:id/approve
POST   /api/v1/mogplex/orchestrations/:id/cancel
GET    /api/v1/mogplex/orchestrations/:id/tasks
```

## Request Shape

```ts
type StartMogplexOrchestrationRequest = {
  repoId: string;
  title?: string;
  request: string;
  baseBranch?: string;
  rootDirectory?: string | null;
  approvalMode?: "manual" | "auto_dispatch" | "autopilot";
};
```

## Orchestration Semantics

The external orchestration API must keep the execution and Git resources
distinct:

> Sandboxes provide isolated compute. Worktrees provide isolated Git
> checkouts. An orchestration task binds them explicitly; neither record may be
> inferred from the other.

A sandbox can exist without a worktree. A worktree can be stopped while its
branch and task record remain. Starting a sandbox must not increment worktree
counts or create a worktree record implicitly.

Every task should have:

- worktree identity and checkout path,
- task branch,
- base branch,
- root directory,
- owned paths,
- sandbox record,
- harness,
- current task status,
- latest pushed commit,
- validation status.

The final output should be a pull request from the integration branch to the base branch.

## MCP Tools

Add only after the HTTP API exists:

```txt
mogplex_start_orchestration
mogplex_get_orchestration
mogplex_get_orchestration_events
mogplex_list_orchestration_tasks
mogplex_approve_orchestration_step
mogplex_cancel_orchestration
```

## State Boundaries

Use the state machine in `lib/orchestrations/state-machine.ts`. External callers should not set arbitrary statuses. They can request actions:

- start,
- approve,
- cancel,
- retry failed task if supported later.

The server owns transitions.

## Approval Policy

Manual approval mode should expose these gates externally:

- approve master spec,
- approve task specs,
- approve final PR creation if the run is not autopilot.

Each approval endpoint should record actor, timestamp, and decision metadata.

## Acceptance Criteria

- External caller can start a draft orchestration.
- External caller can fetch current run state, tasks, and events.
- External caller can approve a waiting gate.
- External caller can cancel an orchestration.
- API preserves branch/root/sandbox identity for every task.
- Final successful orchestration includes PR number and URL.

## Tests

- Start orchestration request validation.
- State transition guard tests through external actions.
- Approval action tests.
- Cancel action tests.
- Events/tasks serialization tests.
- MCP tool schema tests after HTTP routes are stable.

## Handoff

Slice 07 should threat-model orchestration separately because it can create several sandboxes, branches, and agent runs from one external request.
