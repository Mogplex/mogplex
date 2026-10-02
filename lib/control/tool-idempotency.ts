import type { ToolSet } from "ai";
import { hashToolInput } from "@/lib/agents/slack-tool-idempotency";
import {
  normalizeSlackToolExecutionOutput,
  supabaseSlackToolExecutionStore,
  truncateSlackToolExecutionError,
  type SlackToolExecutionStore,
} from "@/lib/agents/slack-tool-idempotency-store";

const PROTECTED_TOOLS = new Set(["open_pr", "git_push", "deploy"]);
const uncertainResult = () => ({
  ok: false,
  deduplicated: true,
  error: "This turn already attempted this action. Control did not retry it.",
});

/** Same durable ledger as Slack, with one identity per turn/tool/input rather
 * than per occurrence. An uncertain external write is never replayed.
 * Policy and operator approval gates must wrap this layer, so a declined
 * action does not consume the execution identity before approval.
 */
export function wrapControlSideEffects(
  tools: ToolSet,
  context: { userId: string; aiCallId?: string | null },
  store: SlackToolExecutionStore = supabaseSlackToolExecutionStore
): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([name, current]) => {
      const execute = current.execute;
      if (!PROTECTED_TOOLS.has(name) || !execute) return [name, current];
      return [
        name,
        {
          ...current,
          async execute(input: never, options: never) {
            if (!context.aiCallId)
              throw new Error("This action needs an active coordinator turn.");
            const reservation = await store.reserve({
              userId: context.userId,
              scopeKey: `control:${context.aiCallId}`,
              toolName: name,
              inputHash: hashToolInput(input),
              occurrence: 1,
            });
            if (!reservation.acquired)
              return reservation.record.status === "completed"
                ? reservation.record.output
                : uncertainResult();
            let output: unknown;
            try {
              output = await execute(input, options);
            } catch (error) {
              try {
                await store.fail({
                  executionId: reservation.record.id,
                  error: truncateSlackToolExecutionError(
                    error instanceof Error ? error.message : String(error)
                  ),
                });
              } catch (persistError) {
                console.error(
                  "[control-idempotency] failed to save uncertain action",
                  { name, persistError }
                );
              }
              throw error;
            }
            try {
              const replayable = normalizeSlackToolExecutionOutput(output);
              await store.complete({
                executionId: reservation.record.id,
                output: replayable,
              });
              return replayable;
            } catch (error) {
              // The external action already ran. Preserve its first result while
              // leaving the reservation uncertain so another call cannot repeat it.
              console.error(
                "[control-idempotency] could not save action result",
                { name, error }
              );
              return output;
            }
          },
        },
      ];
    })
  ) as ToolSet;
}
