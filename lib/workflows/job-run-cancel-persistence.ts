import { supabaseAdmin } from "@/lib/supabase/admin";
import { JOB_RUN_CONTROL_SELECT } from "./job-run-cancel-types";
import {
  coerceJobRunControlRow,
  getCancelledDurationMs,
} from "./job-run-cancel-helpers";

export async function loadJobRunControlRow(jobRunId: string) {
  const { data, error } = await supabaseAdmin
    .from("job_runs")
    .select(JOB_RUN_CONTROL_SELECT)
    .eq("id", jobRunId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load job run control state: ${error.message}`);
  }

  return coerceJobRunControlRow(data);
}

export async function setJobRunCancelRequested(input: {
  jobRunId: string;
  cancelRequestedAt: string;
  reason: string;
}) {
  const { data, error } = await supabaseAdmin
    .from("job_runs")
    .update({
      cancel_requested_at: input.cancelRequestedAt,
      cancel_reason: input.reason,
      cancel_error: null,
    })
    .eq("id", input.jobRunId)
    .in("status", ["pending", "running"])
    .select(JOB_RUN_CONTROL_SELECT)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to persist job run cancellation request: ${error.message}`
    );
  }

  return coerceJobRunControlRow(data);
}

export async function persistJobRunCancelError(input: {
  jobRunId: string;
  cancelRequestedAt: string;
  reason: string;
  cancelError: string;
}) {
  const { data, error } = await supabaseAdmin
    .from("job_runs")
    .update({
      cancel_requested_at: input.cancelRequestedAt,
      cancel_reason: input.reason,
      cancel_error: input.cancelError,
    })
    .eq("id", input.jobRunId)
    .in("status", ["pending", "running"])
    .select(JOB_RUN_CONTROL_SELECT)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to persist job run cancel error: ${error.message}`);
  }

  return coerceJobRunControlRow(data);
}

export async function finalizeJobRunCancelled(input: {
  jobRunId: string;
  cancelRequestedAt: string;
  cancelledAt: string;
  reason: string;
  cancelError: string | null;
}) {
  const current = await loadJobRunControlRow(input.jobRunId);
  if (!current) {
    return null;
  }

  const completedAt = current.completed_at ?? input.cancelledAt;
  const { data, error } = await supabaseAdmin
    .from("job_runs")
    .update({
      status: "cancelled",
      completed_at: completedAt,
      duration_ms: getCancelledDurationMs(current, input.cancelledAt),
      error: null,
      cancel_requested_at:
        current.cancel_requested_at ?? input.cancelRequestedAt,
      cancelled_at: input.cancelledAt,
      cancel_reason: input.reason,
      cancel_error: input.cancelError,
    })
    .eq("id", input.jobRunId)
    .neq("status", "success")
    .neq("status", "failed")
    .select(JOB_RUN_CONTROL_SELECT)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to finalize job run cancellation: ${error.message}`
    );
  }

  return coerceJobRunControlRow(data) ?? current;
}
