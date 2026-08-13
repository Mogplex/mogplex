export type OrchestrationWorktreeStatus =
  | "creating"
  | "active"
  | "archived"
  | "pruned"
  | "error";

export type OrchestrationWorktreeDTO = {
  id: string;
  user_id: string;
  run_id: string;
  task_id: string;
  repo_id: string;
  sandbox_id: string;
  agent_id: string | null;
  branch_name: string;
  base_branch: string;
  checkout_path: string;
  status: OrchestrationWorktreeStatus;
  latest_commit_sha: string | null;
  error: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  pruned_at: string | null;
};

export type WorktreeTaskContext = {
  id: string;
  run_id: string;
  repo_id: string;
  branch_name: string;
  base_branch: string;
  agent_id: string | null;
  run: {
    id: string;
    user_id: string;
    repo_id: string;
  };
};

export type WorktreeSandboxContext = {
  id: string;
  repo_id: string;
  status: string;
};

export type WorktreeCommandResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};
