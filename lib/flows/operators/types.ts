import type {
  FlowActionNodeData,
  FlowActionOperation,
  FlowAgentNodeRole,
  FlowEdge,
  FlowGraph,
  FlowNode,
  FlowNodeType,
  FlowWaitConfig,
  FlowWaitKind,
  TriggerEvent,
} from "@/lib/types";

export type FlowOperatorValidateContext<TNode extends FlowNode = FlowNode> = {
  node: TNode;
  graph: FlowGraph;
  inbound: FlowEdge[];
  outbound: FlowEdge[];
  startNode: Extract<FlowNode, { type: "start" }>;
  options: { requireRunnableConfig: boolean };
};

export type FlowOperatorDefaultDataInput = {
  /** Sequential index of this node type within the draft (1-based). */
  nextIndex: number;
  /** Optional caller-provided label override. */
  label?: string | null;
  /** Optional caller-provided agent binding (only used by the agent operator). */
  agentId?: string | null;
  /** Optional caller-provided agent role (only used by the agent operator). */
  role?: FlowAgentNodeRole;
  /** Optional action operation (only used by the action operator). */
  operation?: FlowActionOperation;
  /** Optional caller-provided trigger event (only used by the start operator). */
  event?: TriggerEvent;
  /** Optional caller-provided default flag (only used by the start operator). */
  isDefault?: boolean;
};

export type FlowOperatorActionResult = {
  summary: string;
  output: Record<string, unknown>;
};

export type FlowOperatorActionRunner = (input: {
  jobRunId: string;
  nodeId: string;
  action: FlowActionNodeData;
}) => Promise<FlowOperatorActionResult>;

// Token emitted from one operator to its outbound edges. Mirrors the executor's
// internal FlowExecutionToken shape so operator modules can hand back tokens
// without importing executor internals.
export type FlowOperatorEmittedToken = {
  fromNodeId: string;
  label: string;
  text: string;
  skipped: boolean;
  payload?: Record<string, unknown> | null;
};

export type FlowOperatorEmission = {
  targetId: string;
  token: FlowOperatorEmittedToken;
};

export type FlowOperatorNodeRunStatus =
  | "success"
  | "failed"
  | "skipped"
  | "cancelled";

export type FlowOperatorExecuteResult =
  | {
      ok: true;
      emitted: FlowOperatorEmission[];
    }
  | {
      ok: false;
      message: string;
      // Operator-specific failure detail; the executor merges this into the
      // top-level run failure and observability surface.
      execution?: unknown;
    };

// Execution context handed to an operator's `execute`. The executor builds this
// for each node and passes it in. Helpers here cover the full surface that the
// previously-inline switch needed (predecessor outputs, edge selectors,
// best-effort node-run completion, skip handling, durable wait provider).
export type FlowOperatorExecuteContext<TNode extends FlowNode = FlowNode> = {
  node: TNode;
  /** Display label for the node, derived from data.label or node.id. */
  label: string;
  graph: FlowGraph;
  // Tokens received on inbound edges in declaration order.
  inboundTokens: ReadonlyArray<FlowOperatorEmittedToken>;
  // Inbound tokens that were not skipped. Operators that fire only on active
  // upstream branches should consume this rather than re-filtering.
  activeInboundTokens: ReadonlyArray<FlowOperatorEmittedToken>;
  // True when every inbound token was skipped. Operators should usually return
  // a skipped completion in this case.
  shouldSkip: boolean;
  // Outputs produced by upstream nodes earlier in this run. Operators may read
  // and write entries (writes are visible to downstream condition state).
  outputs: Map<string, { label: string; text: string }>;
  // Mutable per-run state. Set by `set_variable` and `transform`, then exposed
  // to downstream conditions under `state.<key>`. Lives only for the duration
  // of this job run — never persisted to the graph itself.
  flowState: Map<string, unknown>;
  // Resolution context used by both condition evaluation and template
  // substitution. Includes metadata, repo, outputs, outputs_by_label,
  // previous_outputs, and the current `state` snapshot.
  resolutionState: Record<string, unknown>;
  // Predecessor outputs filtered to non-empty active tokens, in inbound order.
  predecessorOutputs: () => Array<{ label: string; text: string }>;
  // Construct emissions to all outbound edges. The optional selector trims to
  // a subset (used by condition then/else branches).
  emit: (
    label: string,
    text: string,
    options?: {
      skipped?: boolean;
      payload?: Record<string, unknown> | null;
      selector?: (edge: FlowEdge) => boolean;
    }
  ) => FlowOperatorEmission[];
  // Mark the in-flight flow_node_runs row complete and return its duration.
  // Best-effort: failures are recorded as observability errors and do not
  // propagate.
  completeNodeRun: (completion: {
    status: FlowOperatorNodeRunStatus;
    output?: Record<string, unknown> | null;
    error?: string | null;
  }) => Promise<number>;
  // Emit a "skipped" completion for this node and pass the reason into outbound
  // skipped tokens. Operators commonly delegate to this when shouldSkip is true.
  completeSkipped: (reason: string) => Promise<FlowOperatorExecuteResult>;
  // Identifiers passed through for operators that need to persist auxiliary
  // state (e.g. flow_waits rows for await_event).
  jobRunId: string;
  flowId: string;
  flowVersionId: string | null;
  userId: string;
  installationId: number | null;
  repoId: string | null;
  // Durable wait provider. Operators that need to suspend (delay, await_event)
  // call into this rather than importing trigger.dev directly so tests can
  // swap in a deterministic implementation.
  waitProvider: FlowOperatorWaitProvider;
  // Persistence boundary for await_event. Encapsulates flow_waits row CRUD so
  // the operator does not couple to Supabase directly.
  waitStore: FlowOperatorWaitStore;
  // Runtime boundary for deterministic external actions. The executor binds
  // repo, trigger, credential, and sandbox context; the operator stays pure.
  actionRunner: FlowOperatorActionRunner;
};

export type FlowOperatorWaitProvider = {
  // Schedule a fixed-time wait (delay operator). Returns once the time has
  // elapsed; cancellation should reject.
  sleep: (input: { untilDate: Date }) => Promise<void>;
  // Allocate a wait token plus optional timeout. The returned id doubles as
  // the resume token persisted on flow_waits.
  createToken: (input: {
    idempotencyKey: string;
    timeoutMs: number | null;
  }) => Promise<{ id: string }>;
  // Suspend the current run until the token is completed externally or the
  // timeout fires. The discriminated outcome lets operators distinguish
  // resumption from timeout without exception plumbing.
  waitForToken: <T>(input: {
    tokenId: string;
  }) => Promise<
    { ok: true; output: T } | { ok: false; reason: "timeout"; message: string }
  >;
};

export type FlowOperatorWaitStore = {
  // Insert a flow_waits row in `waiting` status with the trigger.dev token id
  // as the resume_token. Failures bubble — if the wait can't be persisted, the
  // executor should fail the node rather than silently dropping resume routing.
  createWait: (input: {
    userId: string;
    jobRunId: string;
    flowId: string;
    flowVersionId: string | null;
    installationId: number | null;
    repoId: string | null;
    nodeId: string;
    waitKind: FlowWaitKind;
    waitConfig: FlowWaitConfig;
    resumeToken: string;
    expiresAt: Date | null;
  }) => Promise<{ id: string }>;
  // Mark the wait row terminally; called from inside the operator after the
  // wait resolves (resumed) or times out (expired). Idempotent: repeated calls
  // with the same status are a no-op.
  finalizeWait: (input: {
    waitId: string;
    status: "resumed" | "expired" | "cancelled";
  }) => Promise<void>;
};

export type FlowOperatorDefinition<TNode extends FlowNode = FlowNode> = {
  type: TNode["type"];
  /**
   * Whether this operator's execution can fail in a way that a downstream
   * "error" handle can recover from. Operators with `canFail: true` may have
   * an outbound edge with sourceHandle === "error" attached; failures emit a
   * failure token to that edge instead of failing the run. Defaults to false.
   */
  canFail?: boolean;
  /** Per-node structural and data validation. Returns flat error strings. */
  validate?: (ctx: FlowOperatorValidateContext<TNode>) => string[];
  /** Coerce raw persisted JSON into the typed node data shape. */
  coerceData: (raw: Record<string, unknown>) => TNode["data"];
  /** Build default node data for editor inserts and graph initialization. */
  defaultData: (input: FlowOperatorDefaultDataInput) => TNode["data"];
  /**
   * Run the operator at a specific point in the graph. Optional today: the
   * agent and condition operators stay inline in the executor while we land
   * the registry. start/parallel/join/delay/await_event/end provide it here.
   */
  execute?: (
    ctx: FlowOperatorExecuteContext<TNode>
  ) => Promise<FlowOperatorExecuteResult>;
  /**
   * Decide whether the executor should pull this node into the next ready
   * batch given the inbound tokens it has so far. Default behavior (when
   * omitted) is "every inbound edge has emitted a token". Operators that
   * fire early — most notably `join` with `wait_for_any`/`quorum` policies —
   * override this to flip true on the first active token or the Nth active
   * token, including the unreachable case for quorum.
   */
  isReady?: (input: {
    node: TNode;
    incomingCount: number;
    receivedTokens: ReadonlyArray<FlowOperatorEmittedToken>;
  }) => boolean;
};

export type FlowOperatorRegistry = {
  [K in FlowNodeType]: FlowOperatorDefinition<Extract<FlowNode, { type: K }>>;
};
