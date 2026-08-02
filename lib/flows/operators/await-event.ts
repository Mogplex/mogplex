import type {
  FlowAwaitEventConfig,
  FlowAwaitEventNodeData,
  FlowAwaitEventTimeout,
  FlowAwaitEventTimeoutUnit,
  FlowCiWorkflowConclusion,
  FlowNode,
} from "@/lib/types";
import { FAILURE_HANDLE_ID } from "@/lib/flows/graph-helpers";
import type { FlowOperatorDefinition } from "./types";

type AwaitEventNode = Extract<FlowNode, { type: "await_event" }>;

const AWAIT_KINDS = new Set<FlowAwaitEventConfig["kind"]>([
  "github_label_added",
  "github_comment_added",
  "ci_workflow_completed",
  "vercel_preview_ready",
  "manual_approval",
]);
const CI_CONCLUSIONS = new Set<FlowCiWorkflowConclusion>([
  "any",
  "success",
  "failure",
  "cancelled",
]);
const TIMEOUT_UNITS = new Set<FlowAwaitEventTimeoutUnit>([
  "minutes",
  "hours",
  "days",
]);

function isAwaitKind(value: unknown): value is FlowAwaitEventConfig["kind"] {
  return AWAIT_KINDS.has(value as FlowAwaitEventConfig["kind"]);
}

function isTimeoutUnit(value: unknown): value is FlowAwaitEventTimeoutUnit {
  return TIMEOUT_UNITS.has(value as FlowAwaitEventTimeoutUnit);
}

function isCiConclusion(value: unknown): value is FlowCiWorkflowConclusion {
  return CI_CONCLUSIONS.has(value as FlowCiWorkflowConclusion);
}

function readString(
  record: Record<string, unknown>,
  camelKey: string,
  snakeKey?: string
) {
  const value = record[camelKey] ?? (snakeKey ? record[snakeKey] : undefined);
  return typeof value === "string" ? value : "";
}

function coerceTimeout(raw: unknown): FlowAwaitEventTimeout | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const value =
    typeof record.value === "number" && Number.isFinite(record.value)
      ? record.value
      : Number(record.value ?? 0);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = isTimeoutUnit(record.unit) ? record.unit : "hours";
  return { value, unit };
}

function timeoutToMs(timeout: FlowAwaitEventTimeout | null | undefined) {
  if (!timeout) return null;
  switch (timeout.unit) {
    case "minutes":
      return timeout.value * 60 * 1000;
    case "hours":
      return timeout.value * 60 * 60 * 1000;
    case "days":
      return timeout.value * 24 * 60 * 60 * 1000;
  }
}

function coerceConfig(raw: Record<string, unknown>): FlowAwaitEventConfig {
  const rawConfig =
    raw.config && typeof raw.config === "object"
      ? (raw.config as Record<string, unknown>)
      : raw;
  const kind: FlowAwaitEventConfig["kind"] = isAwaitKind(rawConfig.kind)
    ? rawConfig.kind
    : "github_label_added";

  switch (kind) {
    case "github_comment_added":
      return {
        kind,
        bodyContains: readString(
          rawConfig,
          "bodyContains",
          "body_contains"
        ).trim(),
        authorLogin: readString(rawConfig, "authorLogin", "author_login")
          .trim()
          .replace(/^@/, ""),
        prOnly: rawConfig.prOnly !== false && rawConfig.pr_only !== false,
        matchTriggerIssue:
          rawConfig.matchTriggerIssue !== false &&
          rawConfig.match_trigger_issue !== false,
        expectedIssueNumber: null,
      };
    case "ci_workflow_completed":
      return {
        kind,
        workflowName: readString(rawConfig, "workflowName", "workflow_name"),
        conclusion: isCiConclusion(rawConfig.conclusion)
          ? rawConfig.conclusion
          : "success",
        matchTriggerSha:
          rawConfig.matchTriggerSha !== false &&
          rawConfig.match_trigger_sha !== false,
        expectedSha:
          readString(rawConfig, "expectedSha", "expected_sha").trim() || null,
      };
    case "vercel_preview_ready":
      return {
        kind,
        environment: readString(rawConfig, "environment").trim() || "Preview",
        matchTriggerSha:
          rawConfig.matchTriggerSha !== false &&
          rawConfig.match_trigger_sha !== false,
        expectedSha:
          readString(rawConfig, "expectedSha", "expected_sha").trim() || null,
      };
    case "manual_approval":
      return {
        kind,
        prompt: readString(rawConfig, "prompt"),
      };
    case "github_label_added":
    default:
      // Accept both `labelName` (canonical) and `label_name` (legacy assistant
      // payloads): tools and migrations may emit either.
      return {
        kind: "github_label_added",
        labelName: readString(rawConfig, "labelName", "label_name"),
        prOnly: rawConfig.prOnly === true || rawConfig.pr_only === true,
      };
  }
}

function readTriggerSha(state: Record<string, unknown>) {
  const metadata =
    state.metadata && typeof state.metadata === "object"
      ? (state.metadata as Record<string, unknown>)
      : null;
  if (!metadata) return null;
  const sha = metadata.head_sha ?? metadata.after ?? metadata.sha;
  return typeof sha === "string" && sha.trim().length > 0 ? sha.trim() : null;
}

function readPositiveInteger(value: unknown) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function readTriggerIssueNumber(state: Record<string, unknown>) {
  const metadata =
    state.metadata && typeof state.metadata === "object"
      ? (state.metadata as Record<string, unknown>)
      : null;
  if (!metadata) return null;
  return (
    readPositiveInteger(metadata.pr_number) ??
    readPositiveInteger(metadata.issue_number)
  );
}

function resolveRuntimeConfig(
  config: FlowAwaitEventConfig,
  state: Record<string, unknown>
): FlowAwaitEventConfig {
  if (config.kind === "github_comment_added") {
    return {
      ...config,
      expectedIssueNumber:
        config.matchTriggerIssue === false
          ? null
          : readTriggerIssueNumber(state),
    };
  }
  if (
    config.kind === "ci_workflow_completed" ||
    config.kind === "vercel_preview_ready"
  ) {
    return {
      ...config,
      expectedSha:
        config.matchTriggerSha === false ? null : readTriggerSha(state),
    };
  }
  return config;
}

export const awaitEventOperator: FlowOperatorDefinition<AwaitEventNode> = {
  type: "await_event",
  canFail: true,
  validate: ({ node, inbound, outbound }) => {
    const errors: string[] = [];
    const data = node.data;
    if (inbound.length !== 1)
      errors.push(
        `Await node "${data.label}" must have exactly one incoming edge.`
      );
    // Error edges are optional and validated separately; the success path
    // must still have exactly one outgoing edge.
    const successEdges = outbound.filter(
      (edge) => edge.sourceHandle !== FAILURE_HANDLE_ID
    );
    if (successEdges.length !== 1)
      errors.push(
        `Await node "${data.label}" must have exactly one outgoing edge.`
      );
    switch (data.config.kind) {
      case "github_label_added":
        if (!data.config.labelName.trim()) {
          errors.push(
            `Await node "${data.label}" must specify a label name to wait for.`
          );
        }
        break;
      case "github_comment_added":
        break;
      case "ci_workflow_completed":
        if (!data.config.workflowName.trim()) {
          errors.push(
            `Await node "${data.label}" must specify a CI workflow or check name.`
          );
        }
        break;
      case "vercel_preview_ready":
        if (!data.config.environment.trim()) {
          errors.push(
            `Await node "${data.label}" must specify a Vercel environment.`
          );
        }
        break;
      case "manual_approval":
        if (!data.config.prompt.trim()) {
          errors.push(
            `Await node "${data.label}" must describe what needs approval.`
          );
        }
        break;
    }
    return errors;
  },
  coerceData: (raw): FlowAwaitEventNodeData => ({
    label: typeof raw.label === "string" ? raw.label : "Await",
    config: coerceConfig(raw),
    timeout: coerceTimeout(raw.timeout),
  }),
  defaultData: (input): FlowAwaitEventNodeData => ({
    label: input.label?.trim() || `Await ${input.nextIndex}`,
    config: {
      kind: "github_label_added",
      labelName: "",
      prOnly: true,
    },
    timeout: { value: 24, unit: "hours" },
  }),
  execute: async ({
    node,
    label,
    shouldSkip,
    outputs,
    completeNodeRun,
    completeSkipped,
    emit,
    waitProvider,
    waitStore,
    jobRunId,
    flowId,
    flowVersionId,
    userId,
    installationId,
    repoId,
    resolutionState,
  }) => {
    if (shouldSkip) {
      return completeSkipped(
        "Await skipped because every incoming branch was skipped"
      );
    }

    const timeoutMs = timeoutToMs(node.data.timeout);
    const waitConfig = resolveRuntimeConfig(node.data.config, resolutionState);
    if (
      waitConfig.kind === "github_comment_added" &&
      waitConfig.matchTriggerIssue !== false &&
      waitConfig.expectedIssueNumber == null
    ) {
      const message = `Await "${label}" could not resolve the triggering issue or pull request number`;
      await completeNodeRun({
        status: "failed",
        error: message,
        output: {
          kind: waitConfig.kind,
          config: waitConfig,
          reason: "missing_trigger_issue",
        },
      });
      return { ok: false, message };
    }
    // Deterministic idempotency key: a single (job_run, node) cannot create
    // two distinct wait tokens. If the run is retried (e.g. crash recovery),
    // trigger.dev will return the existing token instead of allocating a new
    // one, which preserves the flow_waits row's resume_token uniqueness.
    const idempotencyKey = `flow-wait:${jobRunId}:${node.id}`;
    const token = await waitProvider.createToken({
      idempotencyKey,
      timeoutMs,
    });

    const expiresAt = timeoutMs ? new Date(Date.now() + timeoutMs) : null;
    const persisted = await waitStore.createWait({
      userId,
      jobRunId,
      flowId,
      flowVersionId,
      installationId,
      repoId,
      nodeId: node.id,
      waitKind: waitConfig.kind,
      waitConfig,
      resumeToken: token.id,
      expiresAt,
    });

    type ResumePayload = {
      delivery_id?: string | null;
      [key: string]: unknown;
    };

    const outcome = await waitProvider.waitForToken<ResumePayload>({
      tokenId: token.id,
    });

    if (!outcome.ok) {
      await waitStore.finalizeWait({
        waitId: persisted.id,
        status: "expired",
      });
      const message = `Await "${label}" timed out: ${outcome.message}`;
      await completeNodeRun({
        status: "failed",
        error: message,
        output: {
          kind: node.data.config.kind,
          config: waitConfig,
          timeout_ms: timeoutMs,
          resume_token: token.id,
          reason: "timeout",
        },
      });
      return { ok: false, message };
    }

    if (
      waitConfig.kind === "manual_approval" &&
      outcome.output?.decision !== "approve"
    ) {
      await waitStore.finalizeWait({
        waitId: persisted.id,
        status: "resumed",
      });
      const message = `Await "${label}" was denied`;
      await completeNodeRun({
        status: "failed",
        error: message,
        output: {
          kind: waitConfig.kind,
          config: waitConfig,
          resume_token: token.id,
          resume_payload: outcome.output ?? null,
          reason: "denied",
        },
      });
      return { ok: false, message };
    }

    await waitStore.finalizeWait({
      waitId: persisted.id,
      status: "resumed",
    });

    const summary = `${label} resumed from ${waitConfig.kind}`;
    outputs.set(node.id, { label, text: summary });
    await completeNodeRun({
      status: "success",
      output: {
        kind: waitConfig.kind,
        config: waitConfig,
        resume_token: token.id,
        resume_payload: outcome.output ?? null,
      },
    });
    return {
      ok: true,
      emitted: emit(label, summary, {
        payload: {
          kind: waitConfig.kind,
          resume_payload: outcome.output ?? null,
        },
      }),
    };
  },
};
