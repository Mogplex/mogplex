/**
 * Orchestrator module - Supervisor agent tools, policy, and prompt.
 *
 * The orchestrator is the coordinating agent that plans missions, delegates
 * to worker agents in isolated worktrees, and coordinates integration.
 */

// Registry - tool definitions and factory
export {
  ORCHESTRATOR_TOOLS,
  buildOrchestratorTools,
  getToolDef,
  getToolsByCategory,
  getImplementationStats,
  type OrchestratorToolDef,
  type OrchestratorToolCategory,
  type OrchestratorToolAccess,
  type OrchestratorToolContext,
} from "./registry";

// Policy - execution gates and approval flow
export {
  checkToolPolicy,
  wrapWithPolicy,
  wrapToolsWithPolicy,
  getApprovalRequiredTools,
  hasPendingApproval,
  type PolicyCheckResult,
  type ApprovalRequiredResponse,
  type ToolAuditEntry,
} from "./policy";

// System prompt - orchestrator persona and instructions
export {
  buildOrchestratorSystemPrompt,
  getToolImplementationSummary,
  type OrchestratorPromptContext,
} from "./system-prompt";
