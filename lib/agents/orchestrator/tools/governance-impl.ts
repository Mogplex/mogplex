import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Tool } from "ai";
import {
  createControlApproval,
  type CreateControlApprovalInput,
} from "@/lib/control/approvals-store";
import { defineTool } from "../helpers";
import type { OrchestratorToolContext } from "../types";

/**
 * request_approval — explicit operator approval for actions the policy layer
 * doesn't gate on its own (plans, scope changes, anything the agent judges
 * sensitive). Creates a durable approval row and returns pending; the agent
 * is instructed by the system prompt to stop and surface the request rather
 * than poll or retry.
 */

export type RequestApprovalDeps = {
  createApproval: (
    input: CreateControlApprovalInput
  ) => Promise<{ id: string }>;
};

const defaultRequestApprovalDeps: RequestApprovalDeps = {
  createApproval: (input) => createControlApproval(input),
};

const requestApprovalParams = z.object({
  action: z.string().min(1).max(500).describe("Action requiring approval"),
  reason: z.string().min(1).max(2_000).describe("Reason for the action"),
  urgency: z
    .enum(["low", "normal", "high"])
    .optional()
    .describe("Urgency level"),
});

export function createRequestApprovalTool(
  ctx: OrchestratorToolContext,
  deps: RequestApprovalDeps = defaultRequestApprovalDeps
): Tool {
  return defineTool({
    description:
      "Request operator approval for a protected or sensitive action. Returns a pending approval id — report it to the operator and STOP; do not retry or poll.",
    inputSchema: requestApprovalParams,
    execute: async ({
      action,
      reason,
      urgency,
    }: z.infer<typeof requestApprovalParams>) => {
      try {
        const approval = await deps.createApproval({
          userId: ctx.userId,
          toolName: "request_approval",
          toolCallId: `request-approval-${randomUUID()}`,
          toolInput: { action, reason },
          summary: `${action}: ${reason}`,
          urgency: urgency ?? "normal",
          runId: ctx.missionId ?? null,
          aiCallId: ctx.aiCallId ?? null,
        });
        return {
          status: "pending" as const,
          approvalId: approval.id,
          note: "Approval requested. Tell the operator what you need approved and stop; the decision arrives out-of-band.",
        };
      } catch (error) {
        return {
          status: "error" as const,
          error:
            error instanceof Error ? error.message : "request_approval failed",
        };
      }
    },
  });
}
