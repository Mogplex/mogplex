import { tool } from "ai";
import {
  createControlApproval,
  getControlApprovalByToolCallId,
  resolveControlApproval,
  type CreateControlApprovalInput,
} from "@/lib/control/approvals-store";
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

  // Check for protected branch mutations. git_push is exempt here — it has
  // its own approval path below (approval can override; other protected
  // branch mutations are hard denials).
  if (
    def.access === "mutation" &&
    def.name !== "git_push" &&
    PROTECTED_BRANCH_SENSITIVE.has(def.name)
  ) {
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
 * Policy-denied response shape (protected branches / policy violations —
 * approvals are handled by the AI SDK needsApproval gate, not this).
 */
export type PolicyDeniedResponse = {
  status: "policy_denied";
  tool: string;
  reason: "protected_branch" | "policy_violation";
  summary: string;
};

/**
 * Boundary dependencies for the approval gate, injectable for tests
 * (DI over mocking). Defaults resolve to the control approvals store.
 */
export type PolicyApprovalDeps = {
  createApproval: (
    input: CreateControlApprovalInput
  ) => Promise<{ id: string }>;
  resolveApprovalByToolCall: (input: {
    userId: string;
    toolCallId: string;
  }) => Promise<void>;
};

const defaultApprovalDeps: PolicyApprovalDeps = {
  createApproval: (input) => createControlApproval(input),
  resolveApprovalByToolCall: async (input) => {
    const pending = await getControlApprovalByToolCallId(input);
    if (!pending) return;
    await resolveControlApproval({
      approvalId: pending.id,
      userId: input.userId,
      decision: "approved",
      source: "in_stream",
    });
  },
};

/**
 * Wrap a tool with policy enforcement.
 *
 * - Approval-required tools get an AI SDK `needsApproval` gate: the SDK
 *   pauses before execute, emits a tool-approval-request stream part the
 *   control UI renders, and only executes after the operator approves. Each
 *   request also persists a control_approvals row (audit now, headless
 *   approval modes later); execution after approval resolves the row.
 * - Protected-branch / policy violations stay hard denials inside execute.
 * - Every mutation attempt is audit-logged.
 */
export function wrapWithPolicy(
  toolName: string,
  originalTool: Tool,
  ctx: OrchestratorToolContext,
  deps: PolicyApprovalDeps = defaultApprovalDeps
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

  const mayRequireApproval =
    ALWAYS_APPROVAL_REQUIRED.has(def.name) ||
    def.access === "approval" ||
    def.name === "git_push";

  const needsApproval = async (
    input: unknown,
    options: { toolCallId: string }
  ): Promise<boolean> => {
    const policyResult = checkToolPolicy(def, ctx, input);
    if (policyResult.allowed || policyResult.reason !== "approval_required") {
      return false;
    }
    // Persistence is best-effort: a failed write must not skip the gate.
    try {
      await deps.createApproval({
        userId: ctx.userId,
        toolName,
        toolCallId: options.toolCallId,
        toolInput: sanitizeInputForAudit(input) as Record<string, unknown>,
        summary: policyResult.summary,
        runId: ctx.missionId ?? null,
        aiCallId: ctx.aiCallId ?? null,
      });
    } catch (error) {
      console.warn("[orchestrator:policy] approval persist failed", {
        toolName,
        error,
      });
    }
    return true;
  };

  return defineTool({
    description: originalDescription ?? def.description,
    parameters: originalParameters,
    ...(mayRequireApproval ? { needsApproval } : {}),
    execute: async (input: unknown, options?: { toolCallId?: string }) => {
      const policyResult = checkToolPolicy(def, ctx, input);

      // Log audit entry for all mutation attempts
      const auditEntry: ToolAuditEntry = {
        timestamp: new Date().toISOString(),
        toolName,
        category: def.category,
        access: def.access,
        userId: ctx.userId,
        missionId: ctx.missionId,
        allowed:
          policyResult.allowed || policyResult.reason === "approval_required",
        reason: policyResult.allowed ? undefined : policyResult.reason,
        input:
          def.access === "approval"
            ? "[redacted for approval tools]"
            : sanitizeInputForAudit(input),
      };
      logAuditEntry(auditEntry);

      // Hard denials: approval cannot override these.
      if (
        !policyResult.allowed &&
        policyResult.reason !== "approval_required"
      ) {
        const response: PolicyDeniedResponse = {
          status: "policy_denied",
          tool: toolName,
          reason: policyResult.reason,
          summary: policyResult.summary,
        };
        return response;
      }

      // Reaching execute on an approval-gated call means the operator
      // approved in-stream — mirror that decision onto the audit row.
      if (
        !policyResult.allowed &&
        policyResult.reason === "approval_required" &&
        options?.toolCallId
      ) {
        await deps
          .resolveApprovalByToolCall({
            userId: ctx.userId,
            toolCallId: options.toolCallId,
          })
          .catch((error: unknown) => {
            console.warn("[orchestrator:policy] approval resolve failed", {
              toolName,
              error,
            });
          });
      }

      // Execute the original tool
      return (
        originalExecute as (
          input: unknown,
          options?: unknown
        ) => Promise<unknown>
      )(input, options);
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
  ctx: OrchestratorToolContext,
  deps: PolicyApprovalDeps = defaultApprovalDeps
): Record<string, Tool> {
  const wrapped: Record<string, Tool> = {};

  for (const [name, originalTool] of Object.entries(tools)) {
    wrapped[name] = wrapWithPolicy(name, originalTool, ctx, deps);
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
