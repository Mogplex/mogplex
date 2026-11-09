import {
  appendAiCallEvent,
  requestAiCallCancellationIfActive,
} from "@/lib/interactive-runs";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadAutomationScopeForJobRun } from "@/lib/workflows/automation-guardrails";
import { releaseQueuedAutomationJobs } from "@/lib/workflows/queue-release";
import { startAutomationJobRun } from "@/lib/workflows/automation-job-workflow";
import type { ActiveAiCallRow } from "./job-run-cancel-types";

export async function cancelActiveAiCallsForJobRun(
  jobRunId: string,
  cancelRequestedAt: string
) {
  const { data, error } = await supabaseAdmin
    .from("ai_calls")
    .select("id, user_id, conversation_id, repo_id, status, control_state")
    .eq("job_run_id", jobRunId)
    .in("status", ["pending", "streaming"]);

  if (error) {
    throw new Error(
      `Failed to load active AI calls for cancellation: ${error.message}`
    );
  }

  const calls = (data || []) as ActiveAiCallRow[];
  const results = await Promise.all(
    calls.map(async (call) => {
      const next = await requestAiCallCancellationIfActive(
        call.id,
        cancelRequestedAt
      );
      if (next && call.control_state === "active") {
        await appendAiCallEvent({
          aiCallId: call.id,
          userId: call.user_id,
          conversationId: call.conversation_id,
          repoId: call.repo_id,
          eventType: "cancel_requested",
          message: "Parent job run cancellation requested",
          payload: {
            job_run_id: jobRunId,
          },
        });
      }
      return next;
    })
  );

  return {
    total: calls.length,
    requested: results.filter(Boolean).length,
  };
}

export async function cancelRunningFlowNodeRuns(
  jobRunId: string,
  reason: string,
  cancelledAt: string
) {
  const { data, error } = await supabaseAdmin
    .from("flow_node_runs")
    .select("id, started_at")
    .eq("job_run_id", jobRunId)
    .eq("status", "running");

  if (error) {
    throw new Error(`Failed to load running flow node runs: ${error.message}`);
  }

  const nodeRuns = (data || []) as Array<{
    id: string;
    started_at: string | null;
  }>;
  await Promise.all(
    nodeRuns.map(async (nodeRun) => {
      const durationMs = nodeRun.started_at
        ? Math.max(
            0,
            new Date(cancelledAt).getTime() -
              new Date(nodeRun.started_at).getTime()
          )
        : null;

      const { error: updateError } = await supabaseAdmin
        .from("flow_node_runs")
        .update({
          status: "cancelled",
          completed_at: cancelledAt,
          duration_ms: durationMs,
          error: reason,
          output: {
            cancelled: true,
            reason,
          },
        })
        .eq("id", nodeRun.id)
        .eq("status", "running");

      if (updateError) {
        throw new Error(
          `Failed to cancel flow node run ${nodeRun.id}: ${updateError.message}`
        );
      }
    })
  );

  return nodeRuns.length;
}

export async function cancelPendingFlowWaits(
  jobRunId: string,
  cancelledAt: string
) {
  const { error } = await supabaseAdmin
    .from("flow_waits")
    .update({
      status: "cancelled",
      resumed_at: null,
      resume_payload: {
        cancelled: true,
        cancelled_at: cancelledAt,
      },
      resume_delivery_id: null,
    })
    .eq("job_run_id", jobRunId)
    .eq("status", "waiting");

  if (error) {
    throw new Error(`Failed to cancel pending flow waits: ${error.message}`);
  }
}

export async function releaseQueuedJobsAfterTerminalRun(jobRunId: string) {
  const releasedScope = await loadAutomationScopeForJobRun(jobRunId);
  if (!releasedScope) return [];
  return releaseQueuedAutomationJobs({
    releasedScope: {
      ...releasedScope,
      jobRunId,
      status: "cancelled",
    },
    startAutomationJobRun,
  });
}
