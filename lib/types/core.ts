/**
 * Core entity types: profiles, workspaces, repos, agents, assignments, triggers.
 */

import type { RepoGithubAccessState } from "@/lib/github-state";
import type {
  RepoSandboxBillingModeOverride,
  SandboxBillingMode,
} from "@/lib/sandbox/billing";
import type { TriggerEvent } from "./common";
import type { JobRunSummary } from "./job-run";

export type Profile = {
  id: string;
  github_username: string | null;
  github_auth_mode?: "oauth" | "app" | null;
  created_at: string;
};

export type Workspace = {
  id: string;
  user_id: string;
  owner_type?: "user" | "team";
  owner_user_id?: string | null;
  product_team_id?: string | null;
  created_by_user_id?: string | null;
  name: string;
  description?: string | null;
  is_default?: boolean;
  sandbox_billing_mode?: SandboxBillingMode;
  sandbox_timeout_ms?: number | null;
  sandbox_idle_timeout_ms?: number | null;
  sandbox_vercel_team_id?: string | null;
  sandbox_vercel_project_id?: string | null;
  vercel_link_status?:
    | "unknown"
    | "valid"
    | "missing_project"
    | "auth_invalid"
    | "inaccessible";
  vercel_link_checked_at?: string | null;
  vercel_link_error_code?: string | null;
  vercel_link_message?: string | null;
  repo_count?: number;
  created_at: string;
  updated_at: string;
};

export type Repo = {
  id: string;
  user_id: string;
  owner_type?: "user" | "team";
  owner_user_id?: string | null;
  product_team_id?: string | null;
  created_by_user_id?: string | null;
  workspace_id?: string | null;
  github_id?: number;
  github_installation_id?: number | null;
  github_has_app_installation?: boolean;
  github_app_covered?: boolean;
  github_triggerable?: boolean;
  github_access_state?: RepoGithubAccessState;
  github_coverage_label?: string;
  github_coverage_detail?: string;
  full_name: string;
  owner?: string;
  name?: string;
  default_branch?: string;
  is_favorite?: boolean;
  is_hidden?: boolean;
  vercel_team_id?: string | null;
  vercel_project_id?: string | null;
  vercel_link_status?:
    | "unknown"
    | "valid"
    | "missing_project"
    | "auth_invalid"
    | "inaccessible";
  vercel_link_checked_at?: string | null;
  vercel_link_error_code?: string | null;
  vercel_link_message?: string | null;
  sandbox_billing_target?: "personal" | "team";
  sandbox_billing_mode_override?: RepoSandboxBillingModeOverride;
  env_sync_mode?: "sandbox-only" | "sandbox-and-preview" | "vercel-project";
  root_directory?: string | null;
  is_monorepo?: boolean;
  parent_repo_id?: string | null;
  install_command?: string | null;
  dev_command?: string | null;
  dev_port?: number;
  dev_port_auto?: boolean;
  sandbox_timeout_ms?: number | null;
  sandbox_idle_timeout_ms?: number | null;
  sandbox_env_vars?: Record<string, string> | null;
  runtime?: string | null;
  webhook_secret?: string | null;
  snapshot_id?: string | null;
  snapshot_lockfile_hash?: string | null;
  snapshot_created_at?: string | null;
  snapshot_commit_sha?: string | null;
  snapshot_billing_source?: SandboxBillingMode | null;
  snapshot_billing_team_id?: string | null;
  snapshot_billing_project_id?: string | null;
  workspace?: Workspace | null;
  created_at: string;
};

export type Agent = {
  id: string;
  user_id: string;
  name: string;
  slug: string | null;
  model: string;
  system_prompt: string | null;
  description?: string | null;
  category?: string | null;
  source_template?: string | null;
  is_preset?: boolean;
  has_fork?: boolean;
  created_at: string;
};

export type AgentCategoryRow = {
  id: string;
  slug: string;
  label: string;
  created_at: string;
};

export type Assignment = {
  id: string;
  repo_id: string;
  agent_id: string;
  type:
    | "pr_review"
    | "cron_refactor"
    | "cron"
    | "push_review"
    | "issue_triage"
    | "ci_failure";
  cron_schedule: string | null;
  skill_id: string | null;
  enabled: boolean;
  created_at: string;
} & Partial<JobRunSummary>;

export type Trigger = {
  id: string;
  user_id: string;
  installation_id: number;
  agent_id: string;
  event: TriggerEvent;
  is_default: boolean;
  enabled: boolean;
  created_at: string;
} & Partial<JobRunSummary>;
