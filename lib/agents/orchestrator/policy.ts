import { tool } from "ai";
import {
  ORCHESTRATOR_TOOLS,
  getToolDef,
  type OrchestratorToolDef,
  type OrchestratorToolContext,
} from "./registry";
import type { Tool } from "ai";

/**
 * Define a tool with loose typing to match existing patterns.
 */
const defineTool = (def: Record<string, unknown>): Tool =>
  tool(def as Parameters<typeof tool>[0]);

/**
 * Result of a policy check on a tool execution attempt.
 */
export type PolicyCheckResult =
  | { allowed: true }
  | {
      allowed: false;
      reason: "approval_required" | "protected_branch" | "policy_violation";
      summary: string;
    };

/**
 * Tools that always require approval regardless of context.
 */
const ALWAYS_APPROVAL_REQUIRED = new Set([
  "merge_changeset",
  "deploy",
  "promote",
  "rollback",
  "feature_flag_set",
  "delete_file",
  "mcp_grant",
  "mcp_revoke",
  "secrets_read",
]);

/**
 * Mutations that require approval when targeting protected branches.
 */
const PROTECTED_BRANCH_SENSITIVE = new Set([
  "git_push",
  "git_commit",
  "rebase_worktree",
  "cherry_pick",
  "merge_changeset",
]);

/**
 * Default protected branch patterns.
 */
const DEFAULT_PROTECTED_BRANCHES = [
  "main",
  "master",
  "production",
  "release/*",
];

/**
 * Check if a branch name matches any protected pattern.
 */
function isProtectedBranch(
  branch: string | undefined,
  protectedPatterns: string[] = DEFAULT_PROTECTED_BRANCHES
): boolean {
  if (!branch) return false;

  for (const pattern of protectedPatterns) {
    if (pattern.endsWith("/*")) {
      const prefix = pattern.slice(0, -1);
      if (branch.startsWith(prefix)) return true;
    } else if (branch === pattern) {
      return true;
    }
  }

  return false;
}

/**
 * Extract target branch from tool input if present.
 */
function extractTargetBranch(
  toolName: string,
  input: unknown
): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const obj = input as Record<string, unknown>;

  // Different tools use different field names
  if ("branch" in obj && typeof obj.branch === "string") return obj.branch;
  if ("targetBranch" in obj && typeof obj.targetBranch === "string")
    return obj.targetBranch;
  if ("base" in obj && typeof obj.base === "string") return obj.base;
  if ("onto" in obj && typeof obj.onto === "string") return obj.onto;

  return undefined;
}

/**
 * Check tool execution policy.
 *
 * Rules:
 * - "read" access tools: always allowed
 * - "mutation" tools: allowed unless targeting protected branch
 * - "approval" tools: always return approval_required
 * - Tools in ALWAYS_APPROVAL_REQUIRED: always return approval_required
 * - Protected branch mutations: return protected_branch denial
 */
export function checkToolPolicy(
  def: OrchestratorToolDef,
  ctx: OrchestratorToolContext,
  input?: unknown
): PolicyCheckResult {
  // Read-only tools are always allowed
  if (def.access === "read") {
    return { allowed: true };
  }

  // Tools marked as always requiring approval
  if (ALWAYS_APPROVAL_REQUIRED.has(def.name) || def.access === "approval") {
    return {
      allowed: false,
      reason: "approval_required",
      summary: `The ${def.name} action requires operator approval before execution.`,
    };
  }

  // Check for protected branch mutations
  if (def.access === "mutation" && PROTECTED_BRANCH_SENSITIVE.has(def.name)) {
    const targetBranch = extractTargetBranch(def.name, input);
    if (isProtectedBranch(targetBranch, ctx.protectedBranches)) {
      return {
        allowed: false,
        reason: "protected_branch",
        summary: `Cannot ${def.name} to protected branch "${targetBranch}". Use request_approval to request operator permission.`,
      };
    }
  }

  // git_push to protected branches also requires approval
  if (def.name === "git_push") {
    const targetBranch =
      extractTargetBranch(def.name, input) ?? ctx.repoBranch ?? undefined;
    if (isProtectedBranch(targetBranch, ctx.protectedBranches)) {
      return {
        allowed: false,
        reason: "approval_required",
        summary: `Pushing to protected branch "${targetBranch}" requires operator approval.`,
      };
    }
  }

  // All other mutations are allowed
  return { allowed: true };
}

/**
 * Structured audit log entry for tool execution.
 */
export type ToolAuditEntry = {
  timestamp: string;
  toolName: string;
  category: string;
  access: string;
  userId: string;
  missionId?: string | null;
  allowed: boolean;
  reason?: string;
  input?: unknown;
};

/**
 * Log an audit entry for a tool execution attempt.
 * Currently uses console.log with structured JSON.
 * TODO: Integrate with lib/team-audit.ts when appropriate.
 */
function logAuditEntry(entry: ToolAuditEntry): void {
  // Structured log for now; production should integrate with observability
  console.log("[orchestrator:audit]", JSON.stringify(entry));
}

/**
 * Approval-required response shape.
 */
export type ApprovalRequiredResponse = {
  status: "approval_required";
  tool: string;
  summary: string;
  approvalId?: string;
};

/**
 * Wrap a tool's execute function with policy enforcement.
 * - Checks policy before execution
 * - Logs audit events for mutations
 * - Returns approval_required response for blocked actions
 */
export function wrapWithPolicy(
  toolName: string,
  originalTool: Tool,
  ctx: OrchestratorToolContext
): Tool {
  const def = getToolDef(toolName);
  if (!def) {
    // Unknown tool - pass through unchanged
    return originalTool;
  }

  // Read-only tools don't need wrapping
  if (def.access === "read") {
    return originalTool;
  }

  // Extract the original execute function and schema
  // AI SDK tools have parameters and execute
  const originalExecute = (originalTool as { execute?: unknown }).execute;
  const originalParameters = (originalTool as { parameters?: unknown })
    .parameters;
  const originalDescription = (originalTool as { description?: string })
    .description;

  if (typeof originalExecute !== "function") {
    return originalTool;
  }

  return defineTool({
    description: originalDescription ?? def.description,
    parameters: originalParameters,
    execute: async (input: unknown) => {
      const policyResult = checkToolPolicy(def, ctx, input);

      // Log audit entry for all mutation attempts
      const auditEntry: ToolAuditEntry = {
        timestamp: new Date().toISOString(),
        toolName,
        category: def.category,
        access: def.access,
        userId: ctx.userId,
        missionId: ctx.missionId,
        allowed: policyResult.allowed,
        reason: policyResult.allowed ? undefined : policyResult.reason,
        input:
          def.access === "approval"
            ? "[redacted for approval tools]"
            : sanitizeInputForAudit(input),
      };
      logAuditEntry(auditEntry);

      // Block execution if policy check failed
      if (!policyResult.allowed) {
        const response: ApprovalRequiredResponse = {
          status: "approval_required",
          tool: toolName,
          summary: policyResult.summary,
        };
        return response;
      }

      // Execute the original tool
      return (originalExecute as (input: unknown) => Promise<unknown>)(input);
    },
  });
}

/**
 * Sanitize tool input for audit logging.
 * Removes potentially sensitive fields.
 */
function sanitizeInputForAudit(input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  if (Array.isArray(input)) return input.map(sanitizeInputForAudit);

  const obj = input as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};

  const sensitiveKeys = /^(token|secret|password|credential|key|auth)$/i;

  for (const [key, value] of Object.entries(obj)) {
    if (sensitiveKeys.test(key)) {
      sanitized[key] = "[redacted]";
    } else if (typeof value === "object" && value !== null) {
      sanitized[key] = sanitizeInputForAudit(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Wrap all orchestrator tools with policy enforcement.
 */
export function wrapToolsWithPolicy(
  tools: Record<string, Tool>,
  ctx: OrchestratorToolContext
): Record<string, Tool> {
  const wrapped: Record<string, Tool> = {};

  for (const [name, originalTool] of Object.entries(tools)) {
    wrapped[name] = wrapWithPolicy(name, originalTool, ctx);
  }

  return wrapped;
}

/**
 * Get all tools that would require approval in the current context.
 */
export function getApprovalRequiredTools(
  _ctx: OrchestratorToolContext
): OrchestratorToolDef[] {
  return ORCHESTRATOR_TOOLS.filter((def) => {
    if (def.access === "approval") return true;
    if (ALWAYS_APPROVAL_REQUIRED.has(def.name)) return true;
    return false;
  });
}

/**
 * Check if any pending action requires approval.
 */
export function hasPendingApproval(
  _ctx: OrchestratorToolContext,
  _pendingActions: ReadonlyArray<{ toolName: string; input: unknown }>
): boolean {
  // TODO: Implement approval queue check
  return false;
}
