/**
 * Flow node run persistence helpers for the automation job workflow.
 * Extracted from automation-job-workflow.ts for modularity.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  classifyAutomationInfrastructureFailure,
  formatAutomationInfrastructureFailureLabel,
} from "@/lib/workflows/automation-infra-failures";
import type {
  BestEffortFlowNodeRun,
  BestEffortFlowNodeRunCompletion,
  FlowNodeRunStatus,
} from "@/lib/workflows/automation-job-types";

function buildFlowNodeRunObservabilityError(input: {
  phase: "create" | "update";
  message: string;
}) {
  const infraFailure = classifyAutomationInfrastructureFailure(input.message);
  const phaseLabel = input.phase === "create" ? "creating" : "updating";
  const detail =
    formatAutomationInfrastructureFailureLabel(infraFailure?.failureClass) ??
    input.message;

  return `Flow node run bookkeeping degraded while ${phaseLabel}: ${detail}`;
}

export async function createFlowNodeRun(input: {
  userId: string;
  jobRunId: string;
  flowId: string;
  flowVersionId: string;
  nodeId: string;
  nodeType: string;
  nodeLabel: string | null;
  startedAt?: string;
}) {
  const startedAt = input.startedAt ?? new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("flow_node_runs")
    .insert({
      user_id: input.userId,
      job_run_id: input.jobRunId,
      flow_id: input.flowId,
      flow_version_id: input.flowVersionId,
      node_id: input.nodeId,
      node_type: input.nodeType,
      node_label: input.nodeLabel,
      status: "running",
      started_at: startedAt,
    })
    .select("id, started_at")
    .single();

  if (error) {
    throw new Error(`Failed to create flow node run: ${error.message}`);
  }

  return {
    id: data.id as string,
    startedAt: (data.started_at as string | null) ?? startedAt,
  };
}

export async function completeFlowNodeRun(input: {
  nodeRunId: string;
  status: FlowNodeRunStatus;
  startedAt: string;
  output?: Record<string, unknown> | null;
  error?: string | null;
}) {
  const completedAt = new Date().toISOString();
  const durationMs = Date.now() - new Date(input.startedAt).getTime();
  const { data, error } = await supabaseAdmin
    .from("flow_node_runs")
    .update({
      status: input.status,
      completed_at: completedAt,
      duration_ms: durationMs,
      output: input.output ?? null,
      error: input.error ?? null,
    })
    .eq("id", input.nodeRunId)
    .neq("status", "cancelled")
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to update flow node run: ${error.message}`);
  }

  if (!data) {
    return durationMs;
  }

  return durationMs;
}

export async function createFlowNodeRunBestEffort(
  input: Parameters<typeof createFlowNodeRun>[0]
): Promise<BestEffortFlowNodeRun> {
  const startedAt = input.startedAt ?? new Date().toISOString();

  try {
    const created = await createFlowNodeRun({
      ...input,
      startedAt,
    });

    return {
      id: created.id,
      startedAt: created.startedAt,
      observabilityError: null,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create flow node run";
    console.error("[automation-job] flow node run create degraded", {
      jobRunId: input.jobRunId,
      flowId: input.flowId,
      nodeId: input.nodeId,
      error: message,
    });

    return {
      id: null,
      startedAt,
      observabilityError: buildFlowNodeRunObservabilityError({
        phase: "create",
        message,
      }),
    };
  }
}

export async function completeFlowNodeRunBestEffort(input: {
  nodeRunId: string | null;
  jobRunId: string;
  flowId: string;
  nodeId: string;
  status: FlowNodeRunStatus;
  startedAt: string;
  output?: Record<string, unknown> | null;
  error?: string | null;
}): Promise<BestEffortFlowNodeRunCompletion> {
  const durationMs = Date.now() - new Date(input.startedAt).getTime();

  if (!input.nodeRunId) {
    return { durationMs, observabilityError: null };
  }

  let lastError: string | null = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const persistedDurationMs = await completeFlowNodeRun({
        nodeRunId: input.nodeRunId,
        status: input.status,
        startedAt: input.startedAt,
        output: input.output,
        error: input.error,
      });

      return {
        durationMs: persistedDurationMs,
        observabilityError: null,
      };
    } catch (error) {
      lastError =
        error instanceof Error
          ? error.message
          : "Failed to update flow node run";
    }
  }

  console.error("[automation-job] flow node run update degraded", {
    jobRunId: input.jobRunId,
    flowId: input.flowId,
    nodeId: input.nodeId,
    nodeRunId: input.nodeRunId,
    error: lastError,
  });

  return {
    durationMs,
    observabilityError: buildFlowNodeRunObservabilityError({
      phase: "update",
      message: lastError ?? "Failed to update flow node run",
    }),
  };
}

export async function isJobRunCancellationRequested(jobRunId: string) {
  const { data, error } = await supabaseAdmin
    .from("job_runs")
    .select("status, cancel_requested_at, cancelled_at")
    .eq("id", jobRunId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load job cancellation state: ${error.message}`);
  }

  if (!data) return false;
  return (
    data.status === "cancelled" ||
    Boolean(data.cancel_requested_at) ||
    Boolean(data.cancelled_at)
  );
}

export async function throwIfJobRunCancelled(jobRunId: string) {
  const { JobRunCancelledError } =
    await import("@/lib/workflows/automation-job-types");
  if (await isJobRunCancellationRequested(jobRunId)) {
    throw new JobRunCancelledError();
  }
}
