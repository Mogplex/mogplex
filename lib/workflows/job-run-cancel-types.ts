export type JobRunControlRow = {
  id: string;
  status: "pending" | "running" | "success" | "failed" | "cancelled";
  assignment_id: string | null;
  trigger_id: string | null;
  flow_id: string | null;
  flow_version_id: string | null;
  retry_of_job_run_id: string | null;
  runtime_provider: "trigger" | "workflow" | null;
  runtime_run_id: string | null;
  workflow_run_id: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  error: string | null;
  cancel_requested_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  cancel_error: string | null;
  metadata: Record<string, unknown> | null;
};

export type ActiveAiCallRow = {
  id: string;
  user_id: string;
  conversation_id: string | null;
  repo_id: string | null;
  status: "pending" | "streaming";
  control_state: "active" | "cancel_requested" | "cancelled";
};

export type CancelAutomationJobRunResult =
  | {
      ok: false;
      notFound: true;
    }
  | {
      ok: false;
      notFound: false;
      status: JobRunControlRow["status"];
      cancelable: boolean;
      cancelRequestedAt: string | null;
      cancelledAt: string | null;
      cancelReason: string | null;
      cancelError: string | null;
    }
  | {
      ok: true;
      status: "cancelled";
      cancelRequestedAt: string;
      cancelledAt: string;
      cancelReason: string;
      cancelError: string | null;
      runtimeProvider: JobRunControlRow["runtime_provider"];
      runtimeRunId: string | null;
      aiCallsCancellationRequested: number;
      releasedJobs: Array<{
        jobRunId: string;
        started: boolean;
        reason: string | null;
      }>;
    };

export type ReconcileJobRunResult = {
  jobRunId: string;
  outcome: "cancelled" | "failed" | "skipped";
  reason: string | null;
};

export const JOB_RUN_CONTROL_SELECT = [
  "id",
  "status",
  "assignment_id",
  "trigger_id",
  "flow_id",
  "flow_version_id",
  "retry_of_job_run_id",
  "runtime_provider",
  "runtime_run_id",
  "workflow_run_id",
  "created_at",
  "started_at",
  "completed_at",
  "duration_ms",
  "error",
  "cancel_requested_at",
  "cancelled_at",
  "cancel_reason",
  "cancel_error",
  "metadata",
].join(", ");
