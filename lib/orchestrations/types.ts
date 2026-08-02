import type {
  OrchestrationApprovalMode,
  OrchestrationEventLevel,
  OrchestrationHarness,
  OrchestrationMergeEventStatus,
  OrchestrationRunStatus,
  OrchestrationSpecKind,
  OrchestrationTaskStatus,
} from "./status";

export type OrchestrationRunDTO = {
  id: string;
  workspace_id: string | null;
  repo_id: string;
  title: string;
  slug: string;
  status: OrchestrationRunStatus;
  request: string;
  base_branch: string;
  root_directory: string | null;
  spec_branch: string;
  integration_branch: string;
  approval_mode: OrchestrationApprovalMode;
  master_spec_path: string | null;
  master_spec_blob_sha: string | null;
  planner_sandbox_id: string | null;
  integration_sandbox_id: string | null;
  github_pr_number: number | null;
  github_pr_url: string | null;
  error: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type OrchestrationSpecDTO = {
  id: string;
  run_id: string;
  kind: OrchestrationSpecKind;
  order_index: number | null;
  slug: string;
  title: string;
  // Intentionally open-ended: the DB/API contract allows new spec statuses
  // without a coordinated TypeScript enum update. Use
  // isKnownOrchestrationSpecStatus when consumers need narrowing.
  status: string;
  file_path: string;
  blob_sha: string | null;
  branch_name: string | null;
  owned_paths: string[];
  blocked_paths: string[];
  depends_on: string[];
  acceptance_criteria: string[];
  validation_commands: string[];
  prompt: string | null;
  metadata: Record<string, unknown>;
};

export type OrchestrationTaskDTO = {
  id: string;
  run_id: string;
  spec_id: string;
  repo_id: string;
  agent_id: string | null;
  harness: OrchestrationHarness;
  sandbox_id: string | null;
  branch_name: string;
  base_branch: string;
  root_directory: string | null;
  status: OrchestrationTaskStatus;
  latest_commit_sha: string | null;
  pushed_at: string | null;
  validation_status: string | null;
  validation_summary: string | null;
  error: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type OrchestrationMergeEventDTO = {
  id: string;
  run_id: string;
  task_id: string | null;
  source_branch: string | null;
  target_branch: string;
  status: OrchestrationMergeEventStatus;
  commit_sha: string | null;
  conflict_files: string[];
  log: string | null;
  created_at: string;
};

export type OrchestrationEventDTO = {
  id: string;
  run_id: string;
  task_id: string | null;
  repo_id: string | null;
  sandbox_id: string | null;
  type: string;
  level: OrchestrationEventLevel;
  message: string;
  branch_name: string | null;
  commit_sha: string | null;
  ai_call_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};
