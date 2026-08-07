/**
 * Job run and review finding types.
 */

import type { JobRunStartSource } from "@/lib/job-runs";
import type { BackgroundRuntimeProvider } from "@/lib/runtime-providers";

export type JobRun = {
  id: string;
  assignment_id: string | null;
  trigger_id: string | null;
  flow_id?: string | null;
  flow_version_id?: string | null;
  runtime_provider?: BackgroundRuntimeProvider | null;
  runtime_run_id?: string | null;
  workflow_run_id?: string | null;
  retry_of_job_run_id?: string | null;
  status: "pending" | "running" | "success" | "failed" | "cancelled";
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  duration_ms: number | null;
  error: string | null;
  start_attempts: number;
  last_start_attempt_at?: string | null;
  last_start_error?: string | null;
  last_start_source?: JobRunStartSource | null;
  cancel_requested_at?: string | null;
  cancelled_at?: string | null;
  cancel_reason?: string | null;
  cancel_error?: string | null;
  metadata: Record<string, unknown> | null;
};

export type JobRunSummary = {
  last_job_run_id: string | null;
  last_run_status: JobRun["status"] | null;
  last_run_started_at: string | null;
  last_run_error: string | null;
  running_count: number;
  pending_count: number;
  failed_24h: number;
  suppressed_24h: number;
  deferred_24h: number;
  start_failed_24h: number;
  last_pressure_reason: string | null;
  last_pressure_at: string | null;
  last_run_repairable: boolean;
  last_run_requeueable: boolean;
  last_run_cancelable: boolean;
};

export type ReviewFindingSeverity = "critical" | "warning" | "suggestion";

export type ReviewFinding = {
  severity: ReviewFindingSeverity;
  title: string;
  body: string;
  path: string | null;
  line: number | null;
};

export type JobRunReviewFindingStatus =
  | "open"
  | "issue_creating"
  | "issue_created"
  | "dismissed";

export type JobRunReviewFinding = ReviewFinding & {
  id: string;
  user_id: string;
  job_run_id: string;
  repo_id: string | null;
  repo_full_name: string | null;
  pr_number: number | null;
  head_sha: string | null;
  ordinal: number;
  fingerprint: string;
  status: JobRunReviewFindingStatus;
  issue_number: number | null;
  issue_url: string | null;
  dismissed_at: string | null;
  created_at: string;
  updated_at: string;
};

/** Re-export for backwards compatibility and internal use. */
export type { JobRunSourceKind, JobRunStartSource } from "@/lib/job-runs";
