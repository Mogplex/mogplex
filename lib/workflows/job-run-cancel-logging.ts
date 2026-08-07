import { logAutomationDispatchEvent } from "@/lib/automation-dispatch";
import { getJobRunSourceKind } from "@/lib/job-runs";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { JobRunControlRow } from "./job-run-cancel-types";
import {
  getJobRunControlFlowVersionId,
  getJobRunControlRepoId,
  getJobRunControlInstallationId,
  getJobRunControlSourceType,
} from "./job-run-cancel-helpers";

// `job_runs` no longer carries a denormalized `user_id`, but control events
// still need a stable owner for automation dispatch logging. Resolve that owner
// from the originating assignment -> repo, trigger, or flow record instead.
export async function resolveJobRunControlUserId(
  run: Pick<JobRunControlRow, "assignment_id" | "trigger_id" | "flow_id">
) {
  if (run.assignment_id) {
    const { data: assignment, error: assignmentError } = await supabaseAdmin
      .from("assignments")
      .select("id, repo_id")
      .eq("id", run.assignment_id)
      .maybeSingle<{
        id: string;
        repo_id: string;
      }>();

    if (assignmentError) {
      throw new Error(`Failed to load assignment: ${assignmentError.message}`);
    }
    if (!assignment) return null;

    const { data: repo, error: repoError } = await supabaseAdmin
      .from("repos")
      .select("id, user_id")
      .eq("id", assignment.repo_id)
      .maybeSingle<{
        id: string;
        user_id: string;
      }>();

    if (repoError) {
      throw new Error(`Failed to load repo: ${repoError.message}`);
    }

    return repo?.user_id ?? null;
  }

  if (run.trigger_id) {
    const { data: trigger, error: triggerError } = await supabaseAdmin
      .from("triggers")
      .select("id, user_id")
      .eq("id", run.trigger_id)
      .maybeSingle<{
        id: string;
        user_id: string;
      }>();

    if (triggerError) {
      throw new Error(`Failed to load trigger: ${triggerError.message}`);
    }

    return trigger?.user_id ?? null;
  }

  if (!run.flow_id) {
    return null;
  }

  const { data: flow, error: flowError } = await supabaseAdmin
    .from("flows")
    .select("id, user_id")
    .eq("id", run.flow_id)
    .maybeSingle<{
      id: string;
      user_id: string;
    }>();

  if (flowError) {
    throw new Error(`Failed to load flow: ${flowError.message}`);
  }

  return flow?.user_id ?? null;
}

export async function resolveJobRunControlUserIdSafely(
  run: Pick<JobRunControlRow, "id" | "assignment_id" | "trigger_id" | "flow_id">
) {
  try {
    const userId = await resolveJobRunControlUserId(run);
    if (!userId) {
      console.warn(
        "[job-run-cancel] skipping control event log without owner",
        {
          jobRunId: run.id,
          assignmentId: run.assignment_id,
          triggerId: run.trigger_id,
          flowId: run.flow_id,
        }
      );
    }
    return userId ?? undefined;
  } catch (error) {
    console.error("[job-run-cancel] failed to resolve control event owner", {
      jobRunId: run.id,
      assignmentId: run.assignment_id,
      triggerId: run.trigger_id,
      flowId: run.flow_id,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

export async function logJobRunControlEvent(
  run: Pick<
    JobRunControlRow,
    | "id"
    | "assignment_id"
    | "trigger_id"
    | "flow_id"
    | "flow_version_id"
    | "retry_of_job_run_id"
    | "metadata"
  >,
  input: {
    userId?: string;
    outcome: "cancel_requested" | "cancelled" | "cancel_failed" | "reconciled";
    reason?: string | null;
    metadata?: Record<string, unknown> | null;
  }
) {
  const userId = input.userId ?? (await resolveJobRunControlUserIdSafely(run));
  if (!userId) {
    return;
  }

  try {
    await logAutomationDispatchEvent({
      userId,
      jobRunId: run.id,
      assignmentId: run.assignment_id,
      triggerId: run.trigger_id,
      flowId: run.flow_id,
      flowVersionId: getJobRunControlFlowVersionId(run),
      repoId: getJobRunControlRepoId(run),
      installationId: getJobRunControlInstallationId(run),
      sourceKind: getJobRunSourceKind(run),
      sourceType: getJobRunControlSourceType(run),
      eventKind: "control",
      outcome: input.outcome,
      reason: input.reason ?? null,
      metadata: input.metadata ?? {},
    });
  } catch (error) {
    console.error("[job-run-cancel] failed to log control event", {
      jobRunId: run.id,
      outcome: input.outcome,
      reason: input.reason ?? null,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
