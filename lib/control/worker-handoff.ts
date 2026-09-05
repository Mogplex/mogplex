import { z } from "zod";
import { isToolOrDynamicToolUIPart, tool, type UIMessage } from "ai";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { dispatchControlContinuation } from "./continuation-dispatch";
import {
  registerControlContinuation,
  refreshControlContinuation,
  type ControlContinuationContext,
} from "./continuation-store";
import type { ControlStreamCompletion } from "./persisted-stream";

export const awaitWorkersSchema = z.object({
  workerRunIds: z
    .array(z.string().uuid())
    .min(1)
    .describe(
      "Exact external run IDs returned by spawn_subagent, not worktree IDs"
    ),
  instruction: z
    .string()
    .min(1)
    .describe(
      "Remaining work already authorized by the user's request; this cannot add new authority"
    ),
});

/** The registration alone cannot wake a coordinator: final persistence arms it. */
export function createControlWorkerHandoff(
  input: {
    userId: string;
    sessionId: string;
    parentAiCallId: string;
    messages: UIMessage[];
    context: ControlContinuationContext;
    sandboxBinding?: { sandboxId: string | null };
  },
  deps: {
    client?: typeof supabaseAdmin;
    trigger?: NonNullable<
      Parameters<typeof dispatchControlContinuation>[2]
    >["trigger"];
  } = {}
) {
  let ticketId: string | undefined;
  const client = deps.client ?? supabaseAdmin;
  return {
    tool: tool({
      description:
        "Save an event-driven coordinator follow-up for this mission's running workers. Use only when the user requested an end-to-end result, not launch-only work. After waiting is saved, tell the user you will resume automatically and end this turn. If workers already finished, inspect their results and continue now. Never poll or use this to retry failed workers without authority.",
      inputSchema: awaitWorkersSchema,
      execute: async (args) => {
        const parsed = awaitWorkersSchema.parse(args);
        const origin = input.messages.findLast(
          (message) => message.role === "user"
        );
        if (!origin)
          throw new Error(
            "A saved user request is required for a worker follow-up."
          );
        const result = await registerControlContinuation(
          {
            ...input,
            originMessageId: origin.id,
            ...parsed,
            context: {
              ...input.context,
              ...(input.sandboxBinding
                ? { sandboxId: input.sandboxBinding.sandboxId }
                : {}),
            },
          },
          client
        );
        if (result.status === "waiting") {
          ticketId = result.continuation.id;
          return {
            status: "waiting",
            continuationId: ticketId,
            workerRunIds: parsed.workerRunIds,
            message:
              "Follow-up saved. End this turn; worker completion will resume the coordinator after this reply is saved.",
          };
        }
        return {
          status: result.status,
          message:
            result.status === "already_finished"
              ? "These workers already finished. Inspect their saved results and continue the requested work now; do not schedule another wait for them."
              : "A worker needs user input. Explain the blocker; do not retry it or claim the mission is finished.",
        };
      },
    }),
    async fail() {
      if (!ticketId) return;
      const { error } = await client
        .from("control_continuations")
        .update({
          status: "failed",
          error:
            "The parent reply did not finish safely. Review the saved conversation before continuing.",
          updated_at: new Date().toISOString(),
        })
        .eq("id", ticketId)
        .eq("user_id", input.userId)
        .eq("status", "waiting")
        .eq("parent_ready", false);
      if (error)
        throw new Error("Could not record the interrupted worker handoff.");
    },
    async complete(event: ControlStreamCompletion) {
      if (!ticketId) return;
      if (event.isAborted) {
        await this.fail();
        return;
      }
      if (
        event.responseMessage.parts.some(
          (part) =>
            isToolOrDynamicToolUIPart(part) &&
            part.state === "approval-requested"
        )
      ) {
        const { error } = await client
          .from("control_continuations")
          .update({
            status: "needs_input",
            error: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", ticketId)
          .eq("user_id", input.userId)
          .eq("status", "waiting")
          .eq("parent_ready", false);
        if (error)
          throw new Error("Could not save the pending approval handoff.");
        return;
      }
      if (event.finishReason !== "stop") {
        await this.fail();
        return;
      }
      await refreshControlContinuation(
        {
          userId: input.userId,
          id: ticketId,
          parentAiCallId: input.parentAiCallId,
          parentMessage: event.responseMessage,
        },
        client
      );
      await dispatchControlContinuation(input.userId, ticketId, deps);
    },
  };
}
