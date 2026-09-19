import { z } from "zod";
import {
  CLASSIFY_MAX_LEVELS,
  CLASSIFY_MAX_OPTIONS,
} from "@/lib/flows/operators/classify";

/** The answer type of a classify node, as authored by an API or a person. */
export const classifyOutputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("boolean") }),
  z.object({
    kind: z.literal("choice"),
    options: z
      .array(
        z.object({
          id: z
            .string()
            .regex(/^[\w-]+$/)
            .describe(
              "Stable id. Connect this option's branch with sourceHandle `option:<id>`."
            ),
          label: z
            .string()
            .min(1)
            .describe("The option text the classifier chooses between."),
          description: z
            .string()
            .optional()
            .describe("When this option applies."),
        })
      )
      .min(2)
      .max(CLASSIFY_MAX_OPTIONS),
  }),
  z.object({
    kind: z.literal("scale"),
    levels: z
      .array(z.string().min(1))
      .min(2)
      .max(CLASSIFY_MAX_LEVELS)
      .describe("Level descriptions ordered lowest to highest."),
  }),
]);
