import { tool } from "ai";
import { z } from "zod";
import {
  CLASSIFY_UNCERTAIN_HANDLE_ID,
  CONDITION_HANDLE_IDS,
  FAILURE_HANDLE_ID,
  classifyOptionHandleId,
} from "@/lib/flows/graph-helpers";
import { classifyOutputSchema } from "@/lib/flows/classify-schema";
import { CLASSIFY_DEFAULT_INPUT } from "@/lib/flows/operators/classify";
import type { ToolContext } from "./assistant-tools-node-factories";
import { positionSchema } from "./assistant-tools-schemas";

export const addClassifyNodeParams = z.object({
  label: z.string(),
  question: z
    .string()
    .min(1)
    .describe(
      "One closed question about the state. It is read literally: ask one thing, phrase it positively, and avoid 'and' or 'or'."
    ),
  input: z
    .string()
    .optional()
    .describe(
      "Template for the state to judge. Resolves against metadata, repo, outputs, outputs_by_label, previous_outputs, and state. Defaults to {{previous_outputs}}."
    ),
  output: classifyOutputSchema,
  resultKey: z
    .string()
    .regex(/^[a-zA-Z_]\w*$/)
    .describe(
      "Variable the result is written to. Later nodes read state.<resultKey>.answer, .confidence, and .probabilities."
    ),
  minConfidence: z
    .number()
    .gt(0)
    .lt(1)
    .optional()
    .describe(
      "Optional confidence floor. Answers below it leave through the `uncertain` handle, which must then be connected."
    ),
  position: positionSchema,
});

export function createAddClassifyNodeTool(ctx: ToolContext) {
  return tool({
    description:
      "Add a Classify node that answers one closed question about run state and routes on the answer, without an agent call. Answer types: boolean (connect sourceHandle 'true' and 'false'), choice (connect `option:<id>` for every option), or scale (one ordinary outgoing edge; the answer is a 1-based level position to branch on with an If node reading state.<resultKey>.answer). Prefer this over an agent node when a step only needs to categorize, triage, or gate. Classification failures can be routed with sourceHandle 'error'.",
    inputSchema: addClassifyNodeParams,
    execute: async ({
      label,
      question,
      input,
      output,
      resultKey,
      minConfidence,
      position,
    }: z.infer<typeof addClassifyNodeParams>) => {
      const hydrationError = ctx.requireGraphHydrated();
      if (hydrationError) return hydrationError;
      const id = ctx.mintId("classify");
      ctx.graph.nodes.push({
        id,
        type: "classify",
        position: position ?? ctx.autoPosition(),
        data: {
          label,
          question,
          input: input?.trim() ? input : CLASSIFY_DEFAULT_INPUT,
          output,
          resultKey,
          minConfidence: minConfidence ?? null,
        },
      });
      const answerHandles =
        output.kind === "boolean"
          ? [CONDITION_HANDLE_IDS.true, CONDITION_HANDLE_IDS.false]
          : output.kind === "choice"
            ? output.options.map((option) => classifyOptionHandleId(option.id))
            : [];
      return {
        id,
        handles: {
          answers: answerHandles,
          ...(minConfidence === undefined
            ? {}
            : { uncertain: CLASSIFY_UNCERTAIN_HANDLE_ID }),
          error: FAILURE_HANDLE_ID,
        },
      };
    },
  });
}
