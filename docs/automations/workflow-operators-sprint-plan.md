# Workflow Operators Sprint Plan

Status: Implemented
Date: 2026-04-30
Updated: 2026-07-24
Scope: `/workflows` flow graph operators, execution semantics, durable waits, observability, assistant tools, and flow editor UX.

## Implementation Status

The core sprint has shipped. The codebase now has:

- `lib/flows/operators/registry.ts` and per-operator modules for every current `FlowNodeType`.
- widened `flow_node_runs.node_type` support for shipped operators.
- `If` rule groups while preserving legacy persisted `condition` graphs.
- `Wait` for fixed time waits and `await_event` for GitHub labels and comments,
  CI completion, Vercel preview readiness, and manual approval.
- explicit `join` policies: `wait_for_all`, `wait_for_any`, and `quorum`.
- `set_variable` state writes that downstream `If` nodes can read as `state.<key>`.
- `transform` for deterministic copy, string/array operations, changed-file
  glob matching, and boolean/number casts into per-run state.
- failure recovery through one `error` edge on operators that declare `canFail`.
- deterministic action outcomes for sandbox commands, Slack messages, and repository-scoped GitHub comments, issues, labels, statuses, reviews, and post-workflow safe-merge requests.
- assistant and editor support for the shipped operators.
- built-in starter templates for blank, pull-request review, Dependabot
  autopilot, and issue-triage workflows.

The remaining items from this plan are future product scope, not blockers for the shipped operator model:

- additional provider actions beyond the current Sandbox, Slack, and GitHub set
- deeper editor grouping polish beyond the current insertion controls

See [Flow Operator Registry](./operator-registry.md) for the current developer reference.
See [Workflow Starter Templates](./workflow-starter-templates.md) for the
code-backed quick-start catalog.
See [Reusable Workflow Templates](./reusable-workflow-templates.md) for
personal template storage, sanitization, and target binding.

## Summary

The `/workflows` route renders the flow editor through `components/panes/flows-pane.tsx`. The current graph supports these node types:

- `start`
- `agent`
- `condition`
- `parallel`
- `join`
- `delay`
- `end`

The runtime already executes `condition`, `parallel`, `join`, and `delay` inside `executeResolvedFlow()` in `lib/workflows/automation-job-workflow.ts`, and `delay` already uses Trigger.dev `wait.until()`.

The next sprint should not simply add more node types into the current switch statement. The priority is to turn the existing implicit operator behavior into an explicit operator model, then add durable workflow primitives in a controlled order.

## Product Goal

Operators should let users build useful repo automations without writing code:

- if/then/else branching over event metadata, repo state, and previous node output
- deterministic waits for time and external events
- parallel review or triage branches with clear merge policy
- lightweight state transforms without spending an agent call
- recoverable failure paths for notification, retry, cleanup, or manual review

The editor should feel like a workflow builder, but the runtime should stay deterministic and debuggable.

## Current State

Relevant files:

- `app/(dashboard)/[scope]/workflows/page.tsx` renders `FlowsPane`
- `components/panes/flows-pane.tsx` owns editor UI, insertion menus, inspector controls, and run rail integration
- `lib/types.ts` owns `FlowNodeType`, node data contracts, graph contracts, and `FlowNodeRun`
- `lib/flows/graph.ts` owns graph validation, condition evaluation, coercion, delay duration, and helper traversal
- `lib/flows/editor.ts` owns canvas-to-graph conversion and draft editing helpers
- `lib/flows/assistant-tools.ts` owns AI-assisted graph mutation tools
- `lib/flows/api.ts` owns assistant prompt text and flow API service functions
- `lib/workflows/automation-job-workflow.ts` owns runtime execution, node-run persistence, job state, agent execution, cancellation checks, and Trigger.dev dispatch
- `supabase/migrations/` owns schema changes
- `tests/unit/flow-graph.test.ts` covers graph validation
- `tests/unit/automation-job-workflow.test.ts` covers runtime behavior
- `tests/e2e/flows-pane-keyboard.spec.ts`, `tests/e2e/flows-pane-runs.spec.ts`, and `tests/e2e/flows-api.spec.ts` cover editor, run, and API behavior

Known gap:

- `flow_node_runs.node_type` was initially constrained to `start`, `agent`, and `end`. Runtime now attempts to persist `condition`, `parallel`, `join`, and `delay` node runs, so schema must be widened before operator observability can be trusted.

## Core Invariants

- Flow graphs remain directed acyclic graphs. Do not introduce arbitrary cycles.
- Existing published flow JSON must keep loading through `coerceGraph()`.
- Flow versions are immutable execution inputs. Runtime must execute the graph stored on the published `flow_versions` row.
- Every executable node should create a `flow_node_runs` row when observability is healthy.
- Node-run persistence must remain best-effort. Observability degradation should not turn a valid automation into a failed run unless the actual operator fails.
- Branch skip semantics must be explicit. A skipped branch should not block joins or hide why a downstream node did not run.
- Cancellation checks must remain around long-running work and before/after batches.
- Runtime behavior should live in testable helpers, not only inside a large `switch`.
- Flow assistant tools must only create supported, valid graphs.
- Production migrations must be backward-compatible with the currently deployed app.

## Target Operator Taxonomy

### Existing Operators To Keep

- `agent`: Run a configured Mogplex agent. Existing roles remain `review`, `edit`, and `triage`.
- `condition`: Keep as the persisted legacy type initially, but present it as `If` in the UI.
- `parallel`: Fan out one inbound token to two or more branches.
- `join`: Fan in branches with an explicit merge policy.
- `delay`: Keep as the persisted legacy type initially, but present it as `Wait` for time-based waits.

### Operators To Add

- `await_event`: Wait for an external event before resuming a flow.
- `set_variable`: Write deterministic values into flow runtime state.
- `transform`: Derive deterministic structured state from metadata or previous outputs.
- `notify`: Optional later operator for GitHub comments or other connection-backed notifications.
- `manual_approval`: Shipped as an `await_event` kind so it reuses the durable
  wait and timeout model.

### Operators To Avoid In This Sprint

- Arbitrary loops.
- User-authored JavaScript.
- Unbounded retries.
- A generic "run any tool" node without a narrow permission and observability model.

## Proposed Runtime Shape

Introduce an operator registry so each operator owns its behavior in one place.

Suggested module:

```txt
lib/flows/operators/
  registry.ts
  types.ts
  condition.ts
  agent.ts
  parallel.ts
  join.ts
  delay.ts
  await-event.ts
  state.ts
```

Registry responsibilities:

- default node data
- display label and short description
- allowed incoming edge count
- allowed outgoing handles
- per-node validation
- graph coercion support
- execution handler
- run output shape
- assistant tool metadata
- inspector field schema

Do not move all UI rendering into the registry in the first pass. Start with shared metadata and runtime/validation behavior. UI can consume registry metadata incrementally.

## Slice Execution Order

### Slice 0: Schema And Observability Repair

Owner: Database/runtime foundation.

Goal: Make current non-agent operator node runs persist reliably before adding new behavior.

Write scope:

- `supabase/migrations/*`
- `lib/types.ts`
- `lib/workflows/automation-job-workflow.ts` only if needed for typed status or output cleanup
- `tests/unit/automation-job-workflow.test.ts`
- `tests/e2e/flows-pane-runs.spec.ts` if user-visible run details change

Tasks:

- Add a migration that widens `flow_node_runs.node_type` to all currently supported node types: `start`, `agent`, `condition`, `parallel`, `join`, `delay`, `end`.
- Preserve existing `flow_node_runs.status` values including `cancelled`.
- Add a regression test that proves a flow with `condition`, `parallel`, `join`, and `delay` attempts to persist those node types.
- Confirm observability remains best-effort when node-run persistence fails.

Acceptance criteria:

- Existing published flows continue to load.
- A run containing existing operator nodes records node runs for every node type when DB writes succeed.
- A node-run insert failure still records the degradation as an observability error and does not fail the flow by itself.

Validation:

```txt
pnpm exec tsx --test tests/unit/automation-job-workflow.test.ts
pnpm exec tsx --test tests/unit/flow-graph.test.ts
pnpm exec playwright test tests/e2e/flows-pane-runs.spec.ts --project=chromium
pnpm typecheck
```

### Slice 1: Operator Registry Foundation

Owner: Runtime architecture.

Goal: Extract current operator definitions from scattered switch/case code into a registry without changing behavior.

Write scope:

- `lib/flows/operators/**`
- `lib/flows/graph.ts`
- `lib/flows/editor.ts`
- `lib/flows/assistant-tools.ts`
- `lib/workflows/automation-job-workflow.ts`
- `tests/unit/flow-graph.test.ts`
- `tests/unit/automation-job-workflow.test.ts`

Tasks:

- Define `FlowOperatorDefinition` with validation and execution contracts.
- Register existing operators: `start`, `agent`, `condition`, `parallel`, `join`, `delay`, `end`.
- Move operator-specific validation out of the monolithic `validateFlowGraph()` switch where practical.
- Move operator execution out of the `executeResolvedFlow()` switch where practical.
- Keep graph traversal, token routing, cancellation, and node-run persistence in the executor.
- Add tests that behavior is unchanged for current graphs.

Acceptance criteria:

- No user-visible behavior changes.
- Existing graph tests still pass.
- Runtime tests still pass.
- Adding a future operator requires touching the registry and specific operator module, not every graph/editor/runtime file.

Validation:

```txt
pnpm exec tsx --test tests/unit/flow-graph.test.ts
pnpm exec tsx --test tests/unit/automation-job-workflow.test.ts
pnpm typecheck
```

### Slice 2: If / Then / Else Refactor

Owner: Branching operator.

Goal: Present and model condition nodes as `If` with clearer rule semantics while preserving old `condition` data.

Write scope:

- `lib/types.ts`
- `lib/flows/graph.ts`
- `lib/flows/operators/condition.ts`
- `lib/flows/editor.ts`
- `lib/flows/assistant-tools.ts`
- `lib/flows/api.ts`
- `components/panes/flows-pane.tsx`
- `tests/unit/flow-graph.test.ts`
- `tests/e2e/flows-pane-keyboard.spec.ts`

Tasks:

- Keep persisted node type as `condition` for backward compatibility in this slice.
- Rename UI label from `Condition` to `If`.
- Rename handles in UI copy to `then` and `else`, while continuing to persist handle ids `true` and `false` unless a migration is explicitly added.
- Add field presets for common automation state:
  - `metadata.source_type`
  - `metadata.pr_number`
  - `metadata.head_ref`
  - `metadata.base_ref`
  - `metadata.sender_login`
  - `metadata.labels`
  - `repo.full_name`
  - `repo.default_branch`
  - `previous_outputs`
  - `outputs.<node_id>`
  - `outputs_by_label.<label>`
- Add rule group support in data as an additive shape:

```ts
type FlowConditionRuleGroup = {
  mode: "all" | "any";
  rules: Array<{
    field: string;
    operator: FlowConditionOperator;
    value: string;
  }>;
};
```

- Coerce legacy `{ field, operator, value }` into a one-rule group at runtime.
- Add operators if needed:
  - `matches_regex` only if sandboxed and bounded, otherwise defer
  - `in`
  - `not_in`
  - `is_empty`
  - `is_not_empty`
- Update assistant prompt and tools to say `If` / `then` / `else`.

Acceptance criteria:

- Existing `condition` graphs still execute exactly as before.
- New `If` UI can create and edit at least one-rule branches.
- Rule-group data validates and executes for `all` and `any`.
- Assistant-created `If` nodes validate.

Validation:

```txt
pnpm exec tsx --test tests/unit/flow-graph.test.ts
pnpm exec tsx --test tests/unit/automation-job-workflow.test.ts
pnpm exec playwright test tests/e2e/flows-pane-keyboard.spec.ts --project=chromium
pnpm typecheck
```

### Slice 3: Wait Versus Await

Owner: Durable wait operator.

Goal: Keep time waits simple and add a separate durable event wait primitive.

Write scope:

- `lib/types.ts`
- `lib/flows/operators/delay.ts`
- `lib/flows/operators/await-event.ts`
- `lib/flows/graph.ts`
- `lib/workflows/automation-job-workflow.ts`
- `lib/automation-dispatch.ts`
- `app/api/webhooks/github/route.ts`
- `supabase/migrations/*`
- `components/panes/flows-pane.tsx`
- `tests/unit/automation-job-workflow.test.ts`
- `tests/unit/automation-dispatch.test.ts`
- `tests/unit/github-webhook-route.test.ts`

Tasks:

- Present `delay` as `Wait` in the UI and assistant prompt.
- Keep `delay` only for time-based waits: seconds, minutes, hours.
- Add `await_event` for external resume conditions.
- Design persistence for waiting state. Suggested table:

```sql
flow_waits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  job_run_id uuid not null references job_runs(id) on delete cascade,
  flow_id uuid not null references flows(id) on delete cascade,
  flow_version_id uuid references flow_versions(id) on delete set null,
  node_id text not null,
  wait_kind text not null,
  wait_config jsonb not null default '{}'::jsonb,
  resume_token text not null unique,
  status text not null check (status in ('waiting', 'resumed', 'expired', 'cancelled')),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  resumed_at timestamptz,
  resume_payload jsonb
)
```

- Define first supported await kinds:
  - `ci_workflow_completed`
  - `vercel_preview_ready`
  - `github_label_added`
  - `github_comment_added`
  - `manual_approval`
- Start with one GitHub-backed await kind if the full set is too large.
- Add routing from incoming webhooks to waiting flow resumes.
- Ensure idempotency: the same webhook delivery must not resume a wait twice.
- Define timeout behavior: expired wait marks node failed or takes an optional timeout edge.

Acceptance criteria:

- Time-based `Wait` behavior remains unchanged.
- `await_event` can persist a waiting node and resume the same job from a matching event.
- A non-matching webhook leaves waits untouched.
- Duplicate matching webhook does not resume twice.
- Cancelled job cancels or ignores active waits.

Validation:

```txt
pnpm exec tsx --test tests/unit/automation-job-workflow.test.ts
pnpm exec tsx --test tests/unit/automation-dispatch.test.ts
pnpm exec tsx --test tests/unit/github-webhook-route.test.ts
pnpm typecheck
```

### Slice 4: Join Policies

Owner: Branch merge semantics.

Goal: Make `join` behavior explicit and useful beyond implicit wait-for-all.

Write scope:

- `lib/types.ts`
- `lib/flows/operators/join.ts`
- `lib/flows/graph.ts`
- `lib/workflows/automation-job-workflow.ts`
- `components/panes/flows-pane.tsx`
- `tests/unit/flow-graph.test.ts`
- `tests/unit/automation-job-workflow.test.ts`

Tasks:

- Extend join policy from only `wait_for_all` to:
  - `wait_for_all`
  - `wait_for_any`
  - `quorum`
- Add quorum config:

```ts
type FlowJoinNodeData = {
  label: string;
  policy?: "wait_for_all" | "wait_for_any" | "quorum";
  quorum?: number | null;
};
```

- Define skip behavior:
  - `wait_for_all`: emits success after all inbound edges have emitted active or skipped tokens.
  - `wait_for_any`: emits success after the first active inbound token, and should not block forever on skipped branches.
  - `quorum`: emits success after `quorum` active inbound tokens or fails/skips when quorum can no longer be met.
- Add output details listing active, skipped, and failed source labels.

Acceptance criteria:

- Current `wait_for_all` behavior remains compatible.
- `wait_for_any` does not wait for slow branches once one active branch arrives.
- `quorum` validates its threshold against inbound edge count.
- Run details show why a join emitted.

Validation:

```txt
pnpm exec tsx --test tests/unit/flow-graph.test.ts
pnpm exec tsx --test tests/unit/automation-job-workflow.test.ts
pnpm typecheck
```

### Slice 5: State Operators

Owner: Deterministic flow state.

Goal: Let flows compute and store simple values without an agent call.

Write scope:

- `lib/types.ts`
- `lib/flows/operators/state.ts`
- `lib/flows/graph.ts`
- `lib/workflows/automation-job-workflow.ts`
- `components/panes/flows-pane.tsx`
- `tests/unit/automation-job-workflow.test.ts`
- `tests/unit/flow-graph.test.ts`

Tasks:

- Add `set_variable` operator.
- Add `transform` operator if it can stay deterministic and small.
- Extend runtime token or flow state with a mutable `state` object.
- Make state available to later conditions under `state.<key>`.
- Keep transforms bounded to safe operations:
  - copy field
  - string contains/split/join
  - array length
  - array includes
  - changed-file glob match if metadata has file list
  - boolean and numeric casts
- Store state operator outputs in `flow_node_runs.output`.

Acceptance criteria:

- A flow can set `state.has_tests_changed` and branch on it later.
- State survives through downstream nodes in the same job execution.
- State does not mutate the published graph.
- Invalid paths or unsupported transforms fail validation or the node with clear errors.

Validation:

```txt
pnpm exec tsx --test tests/unit/automation-job-workflow.test.ts
pnpm exec tsx --test tests/unit/flow-graph.test.ts
pnpm typecheck
```

### Slice 6: Failure Edges And Recovery

Owner: Failure routing.

Goal: Allow flows to recover from expected node failures instead of failing the whole job immediately.

Write scope:

- `lib/types.ts`
- `lib/flows/graph.ts`
- `lib/workflows/automation-job-workflow.ts`
- `components/panes/flows-pane.tsx`
- `lib/flows/assistant-tools.ts`
- `tests/unit/automation-job-workflow.test.ts`
- `tests/e2e/flows-pane-runs.spec.ts`

Tasks:

- Add edge-level handles or metadata for failure routing.
- Suggested handles:
  - normal success: existing default handle
  - skipped: optional later
  - failed: `error`
- Add executor behavior:
  - If a node fails and has an error edge, emit an error token to that branch.
  - If a node fails and has no error edge, preserve current fail-fast behavior.
- Add failure payload:

```ts
{
  error: string;
  failed_node_id: string;
  failed_node_label: string;
  failed_node_type: FlowNodeType;
}
```

- Ensure agent failures that already write `ai_calls` failure records still do so.
- Add run details that make recovered failures visible.

Acceptance criteria:

- Existing flows without failure edges still fail fast.
- A flow with a failure edge can continue into a cleanup or notification branch.
- Observability shows both the original failed node and the recovery path.
- Cancellation is not treated as recoverable unless explicitly designed later.

Validation:

```txt
pnpm exec tsx --test tests/unit/automation-job-workflow.test.ts
pnpm exec playwright test tests/e2e/flows-pane-runs.spec.ts --project=chromium
pnpm typecheck
```

### Slice 7: Assistant, Editor, And Docs Hardening

Owner: Product polish and enablement.

Goal: Make the new operator model discoverable and keep AI-assisted graph editing valid.

Write scope:

- `components/panes/flows-pane.tsx`
- `lib/flows/assistant-tools.ts`
- `lib/flows/api.ts`
- `tests/e2e/flows-pane-keyboard.spec.ts`
- `tests/e2e/flows-pane-context-menu.spec.ts`
- docs under `docs/automations/`

Tasks:

- Update insertion menus to group operators:
  - Agents
  - Branching
  - Waiting
  - Parallelism
  - State
  - Recovery
- Update inspector copy and field controls for each operator.
- Add assistant tools for new operators only after runtime validation exists.
- Update assistant system prompt with precise operator semantics.
- Add a short operator reference doc for users/devs.

Acceptance criteria:

- A user can add and configure each shipped operator from the editor.
- Assistant can create valid graphs using shipped operators.
- E2E coverage proves the insertion and inspector paths work.
- Dev docs explain the operator registry and how to add a new operator.

Validation:

```txt
pnpm exec playwright test tests/e2e/flows-pane-keyboard.spec.ts --project=chromium
pnpm exec playwright test tests/e2e/flows-pane-context-menu.spec.ts --project=chromium
pnpm exec tsx --test tests/unit/flow-graph.test.ts
pnpm typecheck
```

## Suggested Sprint Assignment

Use these as parallelizable tickets. Avoid overlapping write scopes unless the registry slice has landed.

1. Schema repair
   - Owner paths: `supabase/migrations/*`, `tests/unit/automation-job-workflow.test.ts`
   - Blocks: all operator observability work

2. Operator registry
   - Owner paths: `lib/flows/operators/**`, `lib/flows/graph.ts`, `lib/workflows/automation-job-workflow.ts`
   - Blocks: most new operators

3. If / Then / Else
   - Owner paths: condition operator module, `components/panes/flows-pane.tsx`, assistant tools
   - Depends on: registry preferred, can begin UI copy work earlier

4. Wait / Await design and first await kind
   - Owner paths: await operator module, migrations, webhook routing
   - Depends on: schema repair; registry strongly preferred

5. Join policies
   - Owner paths: join operator module and executor token readiness logic
   - Depends on: registry preferred

6. State operators
   - Owner paths: state operator module and runtime state object
   - Depends on: registry

7. Failure edges
   - Owner paths: graph edge typing, executor failure path, run details
   - Depends on: registry; should happen after join policy design is stable

8. Editor and assistant hardening
   - Owner paths: `components/panes/flows-pane.tsx`, `lib/flows/assistant-tools.ts`, `lib/flows/api.ts`
   - Depends on: each operator's runtime contract

## Definition Of Done

Each slice is done only when:

- Flow graph validation covers the new or refactored semantics.
- Runtime tests cover success, skip, and failure behavior where applicable.
- UI changes have a focused Playwright test if the user can see or edit the behavior.
- `pnpm typecheck` passes.
- Existing published graph JSON still coerces.
- New migrations are backward-compatible.
- Operator behavior is represented in assistant tools only after runtime support exists.

## Risks And Decisions To Make Early

- Durable resume model: `await_event` needs checkpointing. Decide whether the job remains in `running` while waiting or gets a specific waiting state. If `job_runs.status` stays `running`, observability and cancellation must clearly show active waits.
- Trigger.dev task lifetime: confirm whether long waits should live inside the same Trigger.dev run, or whether waits should persist and start a new task on resume.
- Webhook matching: waits must be scoped by user, installation, repo, flow, job, and event-specific identifiers to avoid cross-resume bugs.
- Join `wait_for_any`: decide whether slower branches should be cancelled, ignored, or allowed to finish in the background. The simplest first version should ignore future tokens after the join has emitted.
- Regex support: defer unless there is a bounded/safe implementation and clear UI validation.
- Manual approval: likely a specialization of `await_event`; do not add a separate execution model unless product requirements force it.

## Non-Goals For This Sprint

- Full visual redesign of the workflows route.
- Arbitrary loops or cyclic graphs.
- Public external API changes.
- Replacing Trigger.dev.
- Moving all flow editor rendering into a registry-driven form system in one PR.
- Broad refactors outside flow graph/operator/runtime paths.
