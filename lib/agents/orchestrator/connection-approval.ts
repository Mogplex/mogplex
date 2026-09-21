import {
  createControlApproval,
  getControlApprovalByToolCallId,
  resolveControlApproval,
} from "@/lib/control/approvals-store";
import { sanitizeInputForAudit } from "./policy";
import type { OrchestratorToolContext } from "./types";
import type { Tool } from "ai";

/** Boundary to the approvals store, injectable for tests (DI over mocking). */
export type ConnectionApprovalDeps = {
  createApproval: typeof createControlApproval;
  resolveApprovalByToolCall: (input: {
    userId: string;
    toolCallId: string;
  }) => Promise<void>;
};

const DEFAULT_DEPS: ConnectionApprovalDeps = {
  createApproval: createControlApproval,
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

type ExecutableTool = Tool & {
  execute?: (input: unknown, options: { toolCallId?: string }) => unknown;
};

/**
 * Put the operator's approval in front of every call to a connection set to
 * `ask`. This is the same in-stream gate the policy layer uses: the AI SDK
 * pauses before execute and Control renders an approval card. Connection tools
 * sit outside the registry, so the policy wrapper passes them through and this
 * is the only gate they get. Each request also leaves a control_approvals row.
 */
export function gateConnectionTools(
  tools: Record<string, Tool>,
  askToolNames: ReadonlySet<string>,
  ctx: Pick<OrchestratorToolContext, "userId" | "missionId" | "aiCallId">,
  deps: ConnectionApprovalDeps = DEFAULT_DEPS
): Record<string, Tool> {
  const gated: Record<string, Tool> = {};

  for (const [toolName, original] of Object.entries(tools)) {
    const execute = (original as ExecutableTool).execute;
    if (!askToolNames.has(toolName) || typeof execute !== "function") {
      gated[toolName] = original;
      continue;
    }

    gated[toolName] = {
      ...original,
      needsApproval: async (
        input: unknown,
        options: { toolCallId: string }
      ) => {
        // Persistence is best-effort: a failed write must not skip the gate.
        await deps
          .createApproval({
            userId: ctx.userId,
            toolName,
            toolCallId: options.toolCallId,
            toolInput: sanitizeInputForAudit(input) as Record<string, unknown>,
            summary: `${toolName} belongs to a connection set to ask before its tools run.`,
            runId: ctx.missionId ?? null,
            aiCallId: ctx.aiCallId ?? null,
          })
          .catch((error: unknown) => {
            console.warn("[control] connection approval persist failed", {
              toolName,
              error,
            });
          });
        return true;
      },
      execute: async (input: unknown, options: { toolCallId?: string }) => {
        // Reaching execute means the operator approved in-stream.
        if (options?.toolCallId) {
          await deps
            .resolveApprovalByToolCall({
              userId: ctx.userId,
              toolCallId: options.toolCallId,
            })
            .catch((error: unknown) => {
              console.warn("[control] connection approval resolve failed", {
                toolName,
                error,
              });
            });
        }
        return execute(input, options);
      },
    } as unknown as Tool;
  }

  return gated;
}
