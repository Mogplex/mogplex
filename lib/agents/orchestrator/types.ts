/**
 * Shared type definitions for the orchestrator tool registry.
 */

/**
 * Tool access levels for orchestrator policy enforcement.
 * - "read": always allowed, no side effects
 * - "mutation": modifies state, allowed unless targeting protected resources
 * - "approval": requires explicit operator approval before execution
 */
export type OrchestratorToolAccess = "read" | "mutation" | "approval";

/**
 * Tool categories organizing the ~45-tool orchestrator surface.
 */
export type OrchestratorToolCategory =
  | "planning"
  | "filesystem"
  | "git"
  | "execution"
  | "mcp"
  | "infrastructure"
  | "delivery"
  | "governance"
  | "memory"
  | "communication";

/**
 * Definition for each orchestrator tool: name, category, description,
 * access level, and implementation status.
 */
export type OrchestratorToolDef = {
  name: string;
  category: OrchestratorToolCategory;
  description: string;
  access: OrchestratorToolAccess;
  implemented: boolean;
};

/**
 * Context passed to buildOrchestratorTools for tool instantiation.
 */
export type OrchestratorToolContext = {
  userId: string;
  sandboxId?: string | null;
  /** Server-owned context found multiple sandboxes, so fallback is unsafe. */
  sandboxSelectionRequired?: boolean;
  repoId?: string | null;
  repoOwner?: string | null;
  repoName?: string | null;
  repoBranch?: string | null;
  repoBaseBranch?: string | null;
  githubToken?: string | null;
  teamId?: string | null;
  missionId?: string | null;
  /** Server-owned orchestration run linked to the Control session. */
  orchestrationRunId?: string | null;
  protectedBranches?: string[];
  /** Scopes memory lanes; without it session/episodic writes are unscoped. */
  conversationId?: string | null;
  workspaceSessionId?: string | null;
  /** Lets tool executions (audit, approvals) reference the owning ai_call. */
  aiCallId?: string | null;
  /** Control-surface execution mode; plan mode hard-denies mutating tools. */
  controlMode?: "plan" | "run" | null;
  /** Operator-selected permission preset, currently retained for policy audit. */
  controlPermissions?: string | null;
};

/**
 * Defaults extracted from context for repo-based tools.
 */
export type RepoToolDefaults = {
  owner?: string;
  repo?: string;
  branch?: string;
  baseBranch?: string;
  rootDirectory?: string | null;
};
