import type { ToolSet } from "ai";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { redactSecretsInValue, redactSecretsInText } from "@/lib/ai-telemetry";
import { controlToolOutcome } from "./tool-outcome";

/** Await intent before a side effect; an unfinished entry is an unknown outcome,
 * never permission to replay. Each SDK tool-call identity is executed once.
 */
export function journalControlTools(
  tools: ToolSet,
  context: { userId: string; aiCallId: string },
  client = supabaseAdmin
): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => {
      const execute = tool.execute;
      if (!execute) return [name, tool];
      return [
        name,
        {
          ...tool,
          async execute(input: never, options: Parameters<typeof execute>[1]) {
            const identity = {
              ai_call_id: context.aiCallId,
              tool_call_id: options.toolCallId,
              user_id: context.userId,
            };
            const { error } = await client
              .from("control_tool_executions")
              .insert({
                ...identity,
                tool_name: name,
                input: redactSecretsInValue(input),
                state: "started",
              });
            if (error)
              throw new Error(
                "Could not record this action safely. It was not executed again."
              );
            let output: unknown;
            try {
              output = await execute(input, options);
            } catch (cause) {
              await client
                .from("control_tool_executions")
                .update({
                  state: "failed",
                  error: redactSecretsInText(
                    cause instanceof Error ? cause.message : String(cause)
                  ),
                  finished_at: new Date().toISOString(),
                })
                .match(identity);
              throw cause;
            }
            const { error: saveError } = await client
              .from("control_tool_executions")
              .update({
                output: redactSecretsInValue(output),
                state:
                  controlToolOutcome("output-available", output) === "failed"
                    ? "failed"
                    : "completed",
                finished_at: new Date().toISOString(),
              })
              .match(identity);
            if (saveError)
              throw new Error(
                "The action ran but its result could not be saved. Check its effects before continuing; do not replay it."
              );
            return output;
          },
        },
      ];
    })
  ) as ToolSet;
}
