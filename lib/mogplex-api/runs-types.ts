/**
 * Shared types and constants for external agent runs.
 *
 * This module defines types and error classes used by both runs.ts and its
 * helper modules. Keeping these in a separate file avoids circular imports.
 */

export const MOGPLEX_API_RUN_HARNESSES = [
  "mogplex",
  "codex",
  "claude-code",
] as const;
export type MogplexApiRunHarness = (typeof MOGPLEX_API_RUN_HARNESSES)[number];

export const MOGPLEX_API_RUN_STATUSES = [
  "pending",
  "streaming",
  "success",
  "failed",
  "cancelled",
  // A run paused at a checkpoint, waiting for the user before it continues.
  // Non-terminal and resumable.
  "awaiting_input",
] as const;
export type MogplexApiRunStatus = (typeof MOGPLEX_API_RUN_STATUSES)[number];

export type StartMogplexApiRunRequest = {
  repoId?: unknown;
  prompt?: unknown;
  harness?: unknown;
  baseBranch?: unknown;
  workingBranch?: unknown;
  createBranch?: unknown;
  rootDirectory?: unknown;
  conversationId?: unknown;
  workspaceSessionId?: unknown;
  mode?: unknown;
  worktreeId?: unknown;
};

export type ExternalAgentRunRow = {
  id: string;
  user_id: string;
  repo_id: string;
  ai_call_id: string;
  sandbox_record_id: string | null;
  sandbox_id: string | null;
  worktree_id: string | null;
  idempotency_key: string;
  request_hash: string;
  harness: MogplexApiRunHarness;
  status: MogplexApiRunStatus;
  prompt: string;
  base_branch: string;
  working_branch: string;
  create_branch: boolean;
  root_directory: string | null;
  conversation_id: string | null;
  workspace_session_id: string | null;
  mode: string | null;
  runtime_provider: string | null;
  runtime_run_id: string | null;
  error: string | null;
  metadata: Record<string, unknown>;
  slack_progress?: unknown;
  slack_progress_revision?: number;
  slack_progress_delivered_key?: string | null;
  slack_progress_delivered_at?: string | null;
  /** Optional during the schema-first rollout; identifies a delivered Slack result. */
  slack_terminal_notification_key?: string | null;
  created_at: string;
  updated_at: string;
};

export type MogplexApiRunDetail = {
  runId: string;
  aiCallId: string;
  sandboxRecordId: string | null;
  sandboxId: string | null;
  worktreeId: string | null;
  repoId: string;
  harness: MogplexApiRunHarness;
  status: MogplexApiRunStatus;
  branch: {
    base: string;
    working: string;
    createBranch: boolean;
  };
  rootDirectory: string | null;
  eventsUrl: string;
  cancelUrl: string;
  createdAt: string;
  updatedAt: string;
  error: string | null;
  runtime: {
    provider: string | null;
    runId: string | null;
  };
};

export class MogplexApiRunError extends Error {
  code: "BAD_REQUEST" | "IDEMPOTENCY_CONFLICT" | "NOT_FOUND";
  status: number;

  constructor(
    code: MogplexApiRunError["code"],
    message: string,
    status: number
  ) {
    super(message);
    this.name = "MogplexApiRunError";
    this.code = code;
    this.status = status;
    Object.setPrototypeOf(this, MogplexApiRunError.prototype);
  }
}
