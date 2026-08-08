/**
 * Governance and approval tools for the orchestrator.
 */
import { z } from "zod";
import type { OrchestratorToolDef } from "../types";

// --- Tool definitions ---

export const GOVERNANCE_TOOLS: OrchestratorToolDef[] = [
  {
    name: "request_approval",
    category: "governance",
    description: "Request operator approval for a protected action",
    access: "read",
    implemented: true,
  },
  {
    name: "check_budget",
    category: "governance",
    description: "Check remaining compute/token budget",
    access: "read",
    implemented: false,
  },
  {
    name: "pause_on_budget",
    category: "governance",
    description: "Pause execution and notify when approaching budget limits",
    access: "mutation",
    implemented: false,
  },
  {
    name: "check_policy",
    category: "governance",
    description: "Verify an action against configured policies",
    access: "read",
    implemented: false,
  },
  {
    name: "write_audit_event",
    category: "governance",
    description: "Write an audit log entry for governance tracking",
    access: "mutation",
    implemented: false,
  },
];

// --- Schemas ---

export const requestApprovalSchema = z.object({
  action: z.string().describe("Action requiring approval"),
  reason: z.string().describe("Reason for the action"),
  urgency: z
    .enum(["low", "normal", "high"])
    .optional()
    .describe("Urgency level"),
});

export const checkBudgetSchema = z.object({
  resource: z
    .enum(["compute", "tokens", "all"])
    .optional()
    .describe("Resource type"),
});

export const pauseOnBudgetSchema = z.object({
  threshold: z.number().describe("Budget threshold percentage"),
  message: z.string().optional().describe("Notification message"),
});

export const checkPolicySchema = z.object({
  action: z.string().describe("Action to check"),
  context: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Action context"),
});

export const writeAuditEventSchema = z.object({
  eventType: z.string().describe("Audit event type"),
  details: z.record(z.string(), z.unknown()).describe("Event details"),
});

// --- Schema map for stub tools ---

export const GOVERNANCE_SCHEMAS: Record<string, z.ZodType> = {
  request_approval: requestApprovalSchema,
  check_budget: checkBudgetSchema,
  pause_on_budget: pauseOnBudgetSchema,
  check_policy: checkPolicySchema,
  write_audit_event: writeAuditEventSchema,
};
