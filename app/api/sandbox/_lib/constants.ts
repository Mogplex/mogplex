export const SANDBOX_STREAM_SELECT =
  "id, sandbox_id, repo_id, user_id, product_team_id, actor_user_id, base_branch, working_branch, limit_claim_id, status, stop_reason, preview_url, snapshot_id, install_log, dev_log, runtime, health_status, error, terminal_cwd, root_directory, persistent, last_health_check_at, last_preview_http_status, last_preview_error, last_boot_error, boot_attempts, last_boot_started_at, last_boot_completed_at, created_at, last_active_at, billing_source, billing_team_id, billing_project_id, vercel_team_id, vercel_project_id, exec_lock_token, exec_lock_started_at";

export const SANDBOX_POST_REPO_SELECT =
  "*, workspace:workspaces(id, sandbox_billing_mode, sandbox_timeout_ms, sandbox_vercel_project_id, sandbox_vercel_team_id)";

export const SANDBOX_SNAPSHOT_WARMUP_ENV = "ENABLE_SANDBOX_SNAPSHOT_WARMUP";

/**
 * Statuses the CLI dashboard surfaces. Historical records (stopped, error)
 * are filtered out -- the CLI only needs things the user might act on.
 */
export const CLI_VISIBLE_STATUSES: ReadonlySet<string> = new Set([
  "creating",
  "installing",
  "running",
  "paused",
]);
