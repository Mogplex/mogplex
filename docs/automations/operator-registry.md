# Flow Operator Registry

Status: Implemented

This document describes the shipped operator model behind the `/workflows` flow editor and runtime.

## Source Files

- `lib/types.ts` defines the persisted graph contracts: `FlowNodeType`, `FlowNode`, `FlowEdge`, and each operator data shape.
- `lib/flows/operators/types.ts` defines the operator contract.
- `lib/flows/operators/registry.ts` registers every supported operator.
- `lib/flows/operators/*.ts` owns per-operator defaults, coercion, validation, readiness, and execution where applicable.
- `lib/flows/graph.ts` owns whole-graph validation and traversal rules that need global graph knowledge.
- `lib/flows/editor.ts` converts between canvas drafts and persisted graph JSON.
- `lib/workflows/automation-job-workflow.ts` owns token routing, cancellation, node-run persistence, failure recovery, and Trigger.dev execution.
- `components/panes/flows-pane.tsx` owns the visible editor, insertion controls, inspector fields, and run details.
- `lib/flows/assistant-tools.ts` and `lib/flows/api.ts` expose the supported operators to the flow assistant.

## Registered Operators

The registry currently covers every persisted `FlowNodeType`:

- `start`: starts a flow from a trigger event and optional start filter.
- `agent`: runs a configured Mogplex agent. It can route failures through an `error` edge.
- `action`: performs a deterministic repository-scoped side effect. Shipped operations run a static sandbox command, send a Slack channel or trigger-thread message, post a GitHub comment, create a GitHub issue, update labels, set a commit status, submit a pull-request review, or request a safe squash merge after the workflow completes.
- `condition`: shown as `If` in the UI. It supports `all` / `any` rule groups and persists legacy handle ids `true` and `false` for then/else branches.
- `classify`: shown as `Classify` in the UI. It asks one closed question about a
  piece of run state and routes on the typed answer, without an agent call. See
  [Classify](#classify) below.
- `parallel`: fans out work to all success-path outbound edges.
- `join`: fans branches back in with `wait_for_all`, `wait_for_any`, or `quorum`.
- `delay`: shown as `Wait` in the UI. It handles fixed time waits through the runtime wait provider.
- `await_event`: waits durably for `github_label_added`,
  `github_comment_added`, `ci_workflow_completed`, `vercel_preview_ready`, or
  `manual_approval`. Comment waits can follow the issue or pull request that
  started the run and optionally match author or text. CI and Vercel waits can
  correlate to the commit that started the run.
- `set_variable`: writes deterministic per-run state that downstream `If` nodes can read as `state.<key>`.
- `transform`: derives typed per-run state from metadata or existing state with
  bounded copy, string/array, changed-file glob, and cast operations.
- `end`: completes a flow branch.

Manual approval ships as an `await_event` kind so it shares the same timeout,
cancellation, and durable resume model.

The editor also offers built-in starter graphs for blank, pull-request review,
Dependabot autopilot, and issue-triage workflows. They are defined separately
in `lib/flows/templates.ts` because templates compose registered operators; they
are not operators themselves.

## Classify

A classify node takes a templated `input` (the state to judge), one `question`,
and an answer type. It runs through the decision layer
(`lib/decisions/classify.ts`, see [decisions](../decisions.md)), so an answer
comes back in a few hundred milliseconds with a probability for every option.

| Answer type | Author provides | Outgoing handles | `state.<resultKey>.answer` |
| --- | --- | --- | --- |
| `boolean` | the question | `true`, `false` | `true` or `false` |
| `choice` | 2 to 255 options, each with a stable `id` | `option:<id>` per option | the chosen option's label |
| `scale` | 2 to 10 level descriptions, lowest first | the default handle | the level's 1-based position |

Every result also carries `confidence` and `probabilities`, and lands in both
run state and the node-run output. A scale does not branch on its own: read
`state.<resultKey>.answer` from an `If` node.

- **Every answer handle must be wired.** Validation rejects a boolean missing a
  branch, an option without an edge, and an edge from a branch that no longer
  exists. The inspector removes edges for options it deletes.
- **Uncertain.** Setting `minConfidence` adds an `uncertain` handle that must be
  wired. An answer below the floor leaves through it, with the answer it leaned
  toward still in run state.
- **No fail-open.** The author chose this node to pick a branch, so an outage,
  a timeout, or an input that resolves to empty fails the node. Wire the
  `error` handle to recover; otherwise the run fails. This differs from the
  runtime's own decisions, which always fail open.
- **Wording is the interface.** The question is read literally. Ask one thing,
  phrase it positively, and avoid "and" or "or". Option descriptions are passed
  to the model as guidance.
- The limits on options and levels are the evaluation model's, not product
  limits. There is no cap on classify nodes per flow or calls per run.

## Operator Contract

Each operator exports a `FlowOperatorDefinition`:

```ts
export type FlowOperatorDefinition<TNode extends FlowNode = FlowNode> = {
  type: TNode["type"];
  canFail?: boolean;
  validate?: (ctx: FlowOperatorValidateContext<TNode>) => string[];
  coerceData: (raw: Record<string, unknown>) => TNode["data"];
  defaultData: (input: FlowOperatorDefaultDataInput) => TNode["data"];
  execute?: (
    ctx: FlowOperatorExecuteContext<TNode>
  ) => Promise<FlowOperatorExecuteResult>;
  isReady?: (input: {
    node: TNode;
    incomingCount: number;
    receivedTokens: ReadonlyArray<FlowOperatorEmittedToken>;
  }) => boolean;
};
```

Use the fields this way:

- `type` must match one member of `FlowNodeType`.
- `canFail` allows one outbound `sourceHandle === "error"` edge. Without it, graph validation rejects error edges for that operator. An error edge carries an active token only when its node failed. When the node succeeds, the edge receives a skipped token, so the recovery branch does not run and a join or end node downstream of it is not left waiting.
- `validate` handles local structural and data rules for one node. Whole-graph invariants stay in `validateFlowGraph()`.
- `coerceData` converts persisted or assistant-produced JSON into the typed node data shape. It must preserve compatibility with old graph JSON.
- `defaultData` is the canonical source for editor insertion defaults.
- `execute` runs deterministic operator behavior when that behavior lives in the operator module. It is optional today: `agent` and `condition` still execute inside `executeResolvedFlow()` in `lib/workflows/automation-job-workflow.ts`; their registry modules currently own validation, coercion, and defaults. The executor still owns scheduling, persistence, cancellation, and token routing.
- `isReady` overrides the default "all inbound edges have emitted" scheduling rule. `join` uses this for `wait_for_any` and `quorum`.

## Runtime Boundaries

Keep these ownership rules intact:

- Operator modules should not import Supabase clients, Trigger.dev primitives, or UI components.
- Durable waits go through `FlowOperatorWaitProvider` and `FlowOperatorWaitStore`.
- Node-run completion goes through `completeNodeRun()` so observability remains best-effort and consistent.
- Failure recovery is coordinated by the executor. An operator reports `{ ok: false, message }`; the executor decides whether to fail fast or emit an error token to the recovery branch.
- Per-run mutable state lives in `flowState`; it is never written back into published graph JSON.
- Assistant tools should only expose operators that have runtime validation and execution support.

## Adding An Operator

1. Add the type and data contract in `lib/types.ts`.
2. Add an operator module in `lib/flows/operators/`.
3. Register it in `lib/flows/operators/registry.ts`.
4. Add coercion and editor conversion support in `lib/flows/editor.ts` if the node is user-editable.
5. Add graph validation coverage in `tests/unit/flow-graph.test.ts`.
6. Add runtime coverage in `tests/unit/automation-job-workflow.test.ts` if the operator executes.
7. Add UI insertion and inspector controls in `components/panes/flows-pane.tsx`.
8. Add assistant tool and prompt support only after validation and runtime behavior exist.
9. Add or update migrations if persisted tables need new allowed values or auxiliary state.

Validation should include:

```txt
pnpm exec tsx --test tests/unit/flow-graph.test.ts
pnpm exec tsx --test tests/unit/automation-job-workflow.test.ts
pnpm typecheck
```

Add focused Playwright coverage when the change affects visible editor behavior.
