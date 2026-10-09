/**
 * Shared types and constants for external agent runs.
 *
 * This module defines types and error classes used by both runs.ts and its
 * helper modules. Keeping these in a separate file avoids circular imports.
 */

/**
 * Git commit SHA pattern: 40 hex chars (SHA-1) or 64 hex chars (SHA-256).
 * Exported for consistent validation across recording, presentation, and artifact reading.
 */
export const COMMIT_SHA_PATTERN = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;

/**
 * Artifact path pattern: .mogplex/artifacts/<name>.json where name starts with
 * alphanumeric and contains only alphanumeric, underscore, or hyphen.
 * Repository-root-relative, explicit output files only.
 */
export const ARTIFACT_PATH_PATTERN =
  /^\.mogplex\/artifacts\/[a-zA-Z0-9][a-zA-Z0-9_-]*\.json$/;

/**
 * Extract and validate the terminal commit SHA from run metadata.
 * Returns null if the key is missing or the value is malformed.
 * Shared by both presentation (presentMogplexApiRun) and the first-write-wins
 * check in reconciliation.
 */
export function extractTerminalCommitSha(
  metadata: Record<string, unknown> | null | undefined
): string | null {
  const sha = metadata?.terminal_commit_sha;
  if (typeof sha !== "string" || !COMMIT_SHA_PATTERN.test(sha)) return null;
  return sha;
}

export const MOGPLEX_API_RUN_HARNESSES = [
  "mogplex",
  "codex",
  "claude-code",
] as const;
export type MogplexApiRunHarness = (typeof MOGPLEX_API_RUN_HARNESSES)[number];

/** Execution modes a Codex or Claude Code run accepts. */
export const MOGPLEX_API_RUN_MODES = ["SAFE", "AUTO", "YOLO"] as const;
export type MogplexApiRunMode = (typeof MOGPLEX_API_RUN_MODES)[number];

/**
 * Orchestration modes that released Mogplex CLIs send under the same `mode`
 * key: `StartRunCommand.mode` in mogplex-cli's packages/tui/src/contracts/
 * commands.ts, checked against v0.3.11. The harness runs them as AUTO. They are
 * stored unchanged, as before modes were validated, so those clients and their
 * idempotent replays keep working. Not documented and
 * not offered to new callers. A mode the CLI adds later is refused until it is
 * listed here.
 */
export const LEGACY_CLI_RUN_MODES = [
  "single",
  "multi_agent",
  "council",
  "review",
  "test",
  "repair",
] as const;
export type LegacyCliRunMode = (typeof LEGACY_CLI_RUN_MODES)[number];
/** A mode that passed validation: a harness mode, or a released CLI's. */
export type AcceptedRunMode = MogplexApiRunMode | LegacyCliRunMode;

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
  /** Roster agent id or `preset:<NAME>` whose instructions shape the run. */
  agentId?: unknown;
};

/** A start request after validation, shared by the normalizer and the store. */
export type NormalizedStartRequest = {
  repoId: string;
  prompt: string;
  harness: MogplexApiRunHarness;
  baseBranch: string;
  workingBranch: string;
  createBranch: boolean;
  rootDirectory: string | null;
  conversationId: string | null;
  workspaceSessionId: string | null;
  mode: AcceptedRunMode | null;
  worktreeId: string | null;
  agentId: string | null;
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
  agent_id: string | null;
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
  agentId: string | null;
  /** The execution mode the run was started with, or null for the default. */
  mode: string | null;
  eventsUrl: string;
  cancelUrl: string;
  createdAt: string;
  updatedAt: string;
  error: string | null;
  runtime: {
    provider: string | null;
    runId: string | null;
  };
  /**
   * The commit SHA at the tip of the working branch when the run finished
   * successfully. Used to pin artifact reads to an immutable commit. Null for
   * older runs or runs that did not finish successfully.
   */
  terminalCommitSha: string | null;
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
