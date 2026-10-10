import type { z } from "zod";
import { McpToolArgumentError, type McpToolResult } from "./mcp-types";

export function parseArgs<T extends z.ZodTypeAny>(
  schema: T,
  args: Record<string, unknown> | undefined
): z.infer<T> {
  const result = schema.safeParse(args ?? {});
  if (result.success) return result.data;

  throw new McpToolArgumentError(
    result.error.issues
      .map(
        (issue) => `${issue.path.join(".") || "arguments"}: ${issue.message}`
      )
      .join("; ")
  );
}

export function textResult(
  text: string,
  structuredContent?: Record<string, unknown>,
  isError = false
): McpToolResult {
  return {
    content: [{ type: "text", text }],
    ...(structuredContent ? { structuredContent } : {}),
    ...(isError ? { isError: true } : { isError: false }),
  };
}
