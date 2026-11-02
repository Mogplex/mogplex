import { z } from "zod";
import type { RepoEnvVars } from "@/lib/repo-settings";
import { ENV_NAME } from "./project-env-names";
import { missingEnvNames } from "@/lib/project-settings/env-var-rows";
import { defineTool } from "./shared";

const requestParams = z.object({
  names: z
    .array(z.string())
    .min(1)
    .describe("Variable names the project needs, e.g. DATABASE_URL."),
  reason: z
    .string()
    .optional()
    .describe("One short line on what they are for, shown to the operator."),
});

type ReadStoredVariables = (
  run: (stored: RepoEnvVars) => Promise<Record<string, unknown>>
) => Promise<Record<string, unknown>>;

/**
 * Control's tool for variables it must not set itself: it names them, and the
 * timeline gives the operator a Set variables button that opens Project
 * settings with those names ready to fill. Values never pass through it.
 */
export function createProjectEnvRequestTool(
  repoId: string,
  readStoredVariables: ReadStoredVariables
) {
  return defineTool({
    description:
      "Ask the operator to fill in environment variables you must not set yourself, such as API keys, tokens, passwords, and connection strings. The operator gets a Set variables button that opens Project settings with these names ready to fill. Pass names only, never values.",
    inputSchema: requestParams,
    execute: async ({ names, reason }: z.infer<typeof requestParams>) => {
      const keys = [...new Set(names.map((name) => name.trim()))];
      const invalid = keys.find(
        (key) => !ENV_NAME.test(key) || key === "__proto__"
      );
      if (invalid !== undefined) {
        return { error: `${invalid || "That"} is not a valid variable name.` };
      }
      return readStoredVariables(async (stored) => {
        const missing = missingEnvNames(stored, keys);
        return {
          ok: true,
          repoId,
          requested: keys,
          missing,
          ...(reason?.trim() ? { reason: reason.trim() } : {}),
          note:
            missing.length > 0
              ? "The operator now sees a Set variables button. Once they save, restart the sandbox so new processes get the values."
              : "All of these are already set.",
        };
      });
    },
  });
}
