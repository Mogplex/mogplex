import type { ToolCallOptions, ToolSet } from "ai";
import type { FlowToolApprovalWaitConfig } from "@/lib/types";
import type {
  FlowOperatorWaitProvider,
  FlowOperatorWaitStore,
} from "./operators/types";

// Approval waits run inside the generateText tool loop, which is bounded by
// the automation generation timeout (25 minutes total) and the Trigger.dev
// task cap. The shared budget keeps a run with several gated tool calls from
// blowing that ceiling: waiting time is deducted as it is spent, and once the
// budget is gone every remaining call is denied immediately instead of
// hanging the run. Approved by Charles 2026-07-22 as a safety backstop and
// registered in the AUTOMATION_LIMITS doc comment
// (lib/workflows/automation-guardrails.ts) — do not change without sign-off.
export const TOOL_APPROVAL_WAIT_BUDGET_MS = 10 * 60_000;
// Below this remainder a wait is pointless: token setup eats seconds and a
// human cannot react. Deny immediately instead.
const TOOL_APPROVAL_MIN_WAIT_MS = 15_000;
// Headroom reserved out of the generation window so the model can still
// finish its final steps after a wait resolves; a wait is never allowed to
// run the loop right up to its deadline.
export const TOOL_APPROVAL_DEADLINE_MARGIN_MS = 60_000;
const TOOL_APPROVAL_INPUT_PREVIEW_LIMIT = 4_000;

export type ToolApprovalContext = {
  userId: string;
  jobRunId: string;
  flowId: string;
  flowVersionId: string | null;
  installationId: number | null;
  repoId: string | null;
  repoFullName: string | null;
  nodeId: string;
  nodeLabel: string | null;
  agentName: string | null;
};

export type ToolApprovalDeps = {
  waitProvider: FlowOperatorWaitProvider;
  waitStore: FlowOperatorWaitStore;
  // Durable budget accounting: total waiting time already spent (or reserved
  // by open waits) for this node run, derived from its persisted flow_waits
  // rows. The budget MUST come from durable state — Trigger.dev wait tokens
  // checkpoint the task and may resume it in a different process, so any
  // in-memory tally would silently reset to a fresh budget.
  loadSpentWaitMs: (input: {
    jobRunId: string;
    nodeId: string;
  }) => Promise<number>;
  now?: () => number;
  // Total timeout of the generateText loop this gate wraps. Each wait is
  // capped to what remains of it (minus the deadline margin), so an approval
  // wait can never push the loop past its own deadline — that would abort
  // the run instead of the promised deny-and-continue.
  generationTimeoutMs?: number;
};

export type ToolApprovalResumePayload = {
  decision?: unknown;
  note?: unknown;
};

type ApprovalDecision =
  | { approved: true; note: string | null }
  | {
      approved: false;
      reason: "denied" | "timeout" | "budget_exhausted" | "deadline";
      note: string | null;
    };

// Reads the approval flags stamped onto flow metadata by the agent-node
// executor. Returns null (no gating) only when the node did not opt in. An
// opted-in context with missing flow identifiers throws instead — running
// the tools ungated would silently void the approval guarantee, so an
// upstream metadata regression must fail the node, not bypass the gate.
export function resolveToolApprovalContext(context: {
  metadata: Record<string, unknown>;
  agent: { name?: string | null };
  repo: {
    id: string;
    user_id: string;
    full_name: string;
    github_installation_id?: number | null;
  };
}): ToolApprovalContext | null {
  const { metadata } = context;
  if (metadata.flow_require_approval !== true) return null;

  const jobRunId = readNonEmptyString(metadata.flow_job_run_id);
  const flowId = readNonEmptyString(metadata.flow_id);
  const nodeId = readNonEmptyString(metadata.flow_node_id);
  if (!jobRunId || !flowId || !nodeId) {
    throw new Error(
      "Tool approval was requested but the flow run identifiers needed to persist approval waits are missing; refusing to execute tools without the gate."
    );
  }

  return {
    userId: context.repo.user_id,
    jobRunId,
    flowId,
    flowVersionId: readNonEmptyString(metadata.flow_version_id),
    installationId:
      typeof context.repo.github_installation_id === "number"
        ? context.repo.github_installation_id
        : null,
    repoId: context.repo.id,
    repoFullName: context.repo.full_name,
    nodeId,
    nodeLabel: readNonEmptyString(metadata.flow_node_label),
    agentName: context.agent.name ?? null,
  };
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

// Serializes budget check-and-reserve per node run. This holds no accounting
// state (that lives in the durable wait rows) — it only orders concurrent
// reservations within one process so each observes the previous one's row.
// Entries clean themselves up once their chain drains.
const nodeRunReservationLocks = new Map<string, Promise<unknown>>();

async function withNodeRunReservationLock<T>(
  key: string,
  fn: () => Promise<T>
): Promise<T> {
  // The stored chain is always a `settled` promise, which never rejects —
  // so a single fulfillment handler runs `fn` exactly once per reservation.
  const previous = nodeRunReservationLocks.get(key) ?? Promise.resolve();
  const run = previous.then(fn);
  const settled = run.catch(() => undefined).then(() => undefined);
  nodeRunReservationLocks.set(key, settled);
  void settled.then(() => {
    if (nodeRunReservationLocks.get(key) === settled) {
      nodeRunReservationLocks.delete(key);
    }
  });
  return run;
}

function serializeToolInput(input: unknown): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(input) ?? "null";
  } catch {
    serialized = "[unserializable input]";
  }
  return serialized.length > TOOL_APPROVAL_INPUT_PREVIEW_LIMIT
    ? `${serialized.slice(0, TOOL_APPROVAL_INPUT_PREVIEW_LIMIT)}…`
    : serialized;
}

function normalizeNote(note: unknown): string | null {
  return typeof note === "string" && note.trim().length > 0
    ? note.trim()
    : null;
}

// The denial replaces the tool output entirely (the tool never ran), so its
// shape only has to make sense to the model. `approved: false` also keeps
// structured extractors safe: they key on success fields the denial lacks.
function deniedToolOutput(
  toolName: string,
  decision: Extract<ApprovalDecision, { approved: false }>
) {
  const message =
    decision.reason === "denied"
      ? `Tool call "${toolName}" was denied by a human operator${
          decision.note ? `: ${decision.note}` : ""
        }. Do not retry the same call; adjust your plan instead.`
      : decision.reason === "timeout"
        ? `Tool call "${toolName}" was not approved within the approval window. Treat it as denied and continue without it.`
        : decision.reason === "deadline"
          ? `Tool call "${toolName}" was denied automatically because the run is close to its execution deadline. Continue without it and wrap up.`
          : `Tool call "${toolName}" was denied automatically because this run's approval window is exhausted. Continue without it.`;
  return {
    approved: false,
    denied_by_operator: decision.reason === "denied",
    reason: decision.reason,
    message,
  };
}

// Steering notes ride along with the tool output the model already expects.
// Structured extractors read fields off record outputs (e.g. updateFile's
// success/path), so the note is added as an extra key — never a wrapper that
// would change the output's shape.
function withOperatorNote(output: unknown, note: string): unknown {
  if (typeof output === "string") {
    return `${output}\n\n[Operator note]: ${note}`;
  }
  if (output && typeof output === "object" && !Array.isArray(output)) {
    return { ...(output as Record<string, unknown>), operator_note: note };
  }
  return output;
}

async function requestToolCallApproval(input: {
  toolName: string;
  toolCallId: string;
  toolInput: unknown;
  gateScope: string;
  context: ToolApprovalContext;
  deps: ToolApprovalDeps;
  generationDeadlineAt: number | null;
}): Promise<ApprovalDecision> {
  const { context, deps } = input;
  const now = deps.now ?? Date.now;

  // Check-and-reserve runs under a per-node-run lock: the AI SDK can execute
  // several tool calls of one step concurrently, and without serialization
  // each would read the spent budget before any of them persisted a
  // reservation — together overdrawing the shared cap. The lock is purely
  // in-process serialization (concurrent calls of one step always share a
  // process); the accounting itself stays durable in the wait rows. Only the
  // reservation is serialized — the waits themselves run concurrently so all
  // pending approvals stay visible to the operator at once.
  const reservation = await withNodeRunReservationLock(
    `${context.jobRunId}:${context.nodeId}`,
    async (): Promise<
      | Extract<ApprovalDecision, { approved: false }>
      | { approved: null; tokenId: string; waitId: string }
    > => {
      const spentWaitMs = await deps.loadSpentWaitMs({
        jobRunId: context.jobRunId,
        nodeId: context.nodeId,
      });
      const budgetRemainingMs = TOOL_APPROVAL_WAIT_BUDGET_MS - spentWaitMs;
      if (budgetRemainingMs < TOOL_APPROVAL_MIN_WAIT_MS) {
        return { approved: false, reason: "budget_exhausted", note: null };
      }

      // Cap the wait to the enclosing loop's remaining generation window: a
      // wait that outlives the deadline aborts the run instead of denying.
      const deadlineRemainingMs =
        input.generationDeadlineAt === null
          ? Number.POSITIVE_INFINITY
          : input.generationDeadlineAt - now();
      if (deadlineRemainingMs < TOOL_APPROVAL_MIN_WAIT_MS) {
        return { approved: false, reason: "deadline", note: null };
      }
      const timeoutMs = Math.min(budgetRemainingMs, deadlineRemainingMs);
      // gateScope is unique per gated loop: provider toolCallIds are only
      // unique within one model generation, and this node may gate several
      // (review, autofix, sandbox fix). Without the scope, a later loop
      // emitting the same toolCallId would receive the earlier loop's
      // already-completed token from the idempotency cache and replay a
      // stale decision without a fresh human approval.
      const token = await deps.waitProvider.createToken({
        idempotencyKey: `flow-tool-approval:${context.jobRunId}:${context.nodeId}:${input.gateScope}:${input.toolCallId}`,
        timeoutMs,
      });

      const waitConfig: FlowToolApprovalWaitConfig = {
        kind: "tool_approval",
        toolName: input.toolName,
        toolCallId: input.toolCallId,
        toolInput: serializeToolInput(input.toolInput),
        nodeId: context.nodeId,
        nodeLabel: context.nodeLabel,
        agentName: context.agentName,
        repoFullName: context.repoFullName,
      };

      const persisted = await deps.waitStore.createWait({
        userId: context.userId,
        jobRunId: context.jobRunId,
        flowId: context.flowId,
        flowVersionId: context.flowVersionId,
        installationId: context.installationId,
        repoId: context.repoId,
        nodeId: context.nodeId,
        waitKind: "tool_approval",
        waitConfig,
        resumeToken: token.id,
        expiresAt: new Date(now() + timeoutMs),
      });
      return { approved: null, tokenId: token.id, waitId: persisted.id };
    }
  );
  if (reservation.approved === false) {
    return reservation;
  }
  const { tokenId, waitId } = reservation;

  const outcome =
    await deps.waitProvider.waitForToken<ToolApprovalResumePayload>({
      tokenId,
    });

  // No in-memory budget mutation: the persisted row itself carries the
  // charge. A resumed row costs its actual waiting time (resumed_at −
  // created_at); an expired or abandoned row costs its full reserved window
  // (expires_at − created_at), which is exactly timeoutMs.
  if (!outcome.ok) {
    await deps.waitStore.finalizeWait({
      waitId,
      status: "expired",
    });
    return { approved: false, reason: "timeout", note: null };
  }

  await deps.waitStore.finalizeWait({
    waitId,
    status: "resumed",
  });

  const note = normalizeNote(outcome.output?.note);
  // Fail closed: only an explicit approve runs the tool. Any other payload —
  // a deny, a malformed resume, an empty object — is treated as a denial.
  if (outcome.output?.decision === "approve") {
    return { approved: true, note };
  }
  return { approved: false, reason: "denied", note };
}

// Wraps every executable tool in an approval gate. Tools without an execute
// function (provider-executed) pass through untouched. Wait persistence
// failures bubble and fail the tool call — never fail open past the gate.
// The wait budget is shared across every gated loop of the same node run,
// not per wrapper invocation.
export function wrapToolsWithApprovalGate(
  tools: ToolSet,
  context: ToolApprovalContext,
  deps: ToolApprovalDeps
): ToolSet {
  // The deadline is anchored at wrap time, which is immediately before the
  // gated generateText call starts its clock.
  const generationDeadlineAt =
    typeof deps.generationTimeoutMs === "number" &&
    Number.isFinite(deps.generationTimeoutMs)
      ? (deps.now ?? Date.now)() +
        deps.generationTimeoutMs -
        TOOL_APPROVAL_DEADLINE_MARGIN_MS
      : null;
  // Unique identity for this gated loop. Provider toolCallIds repeat across
  // separate generations, so the wait-token idempotency key must be scoped
  // per loop or a later loop could replay an earlier loop's decision.
  const gateScope = crypto.randomUUID();

  return Object.fromEntries(
    Object.entries(tools).map(([toolName, tool]) => {
      const execute = tool.execute;
      if (typeof execute !== "function") {
        return [toolName, tool];
      }
      const gated = {
        ...tool,
        execute: async (toolInput: unknown, options: ToolCallOptions) => {
          // Fallback ids (only when the SDK omits toolCallId) must be unique
          // across loops AND process restarts — a repeated id would reuse an
          // already-completed wait token via the idempotency key and apply a
          // stale decision to a different call. A random id guarantees that
          // without any shared state; the cost is one leaked (auto-expiring,
          // budget-charged) token if the process dies mid-wait.
          const toolCallId =
            typeof options?.toolCallId === "string" &&
            options.toolCallId.length > 0
              ? options.toolCallId
              : `${toolName}-fallback-${crypto.randomUUID()}`;
          const decision = await requestToolCallApproval({
            toolName,
            toolCallId,
            toolInput,
            gateScope,
            context,
            deps,
            generationDeadlineAt,
          });
          if (!decision.approved) {
            return deniedToolOutput(toolName, decision);
          }
          const output = await execute.call(
            tool,
            toolInput as never,
            options as never
          );
          return decision.note
            ? withOperatorNote(output, decision.note)
            : output;
        },
      };
      return [toolName, gated as unknown as ToolSet[string]];
    })
  );
}
