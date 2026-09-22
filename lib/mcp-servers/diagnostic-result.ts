import type { ToolApproval } from "./policy";
import { z } from "zod";

export const diagnosticMessages = {
  settings_unavailable:
    "Mogplex could not read the saved connection. Try again later.",
  invalid_policy:
    "The tool permissions are invalid. Edit the server and correct its permission fields in Extra JSON.",
  unsafe_url:
    "The URL must resolve to a public HTTP or HTTPS server. Local servers work through the CLI only.",
  missing_secret:
    "A saved header secret is missing. Edit the server and enter its value again.",
  authentication:
    "The server rejected access. Check the saved authorization header and its permissions.",
  timeout:
    "The server did not finish the connection test in time. Check the server, then test again.",
  connection:
    "The connection test failed. Check the server URL, Streamable HTTP support, and saved headers.",
  cli_only:
    "Local servers run through the CLI. Test this server from the CLI on your computer.",
} as const;

export type DiagnosticCode = keyof typeof diagnosticMessages;
export type McpDiagnosticResult = {
  checkedAt: string;
  serverUpdatedAt: string;
} & (
  | {
      status: "success";
      enabled: boolean;
      tools: Array<{ name: string; approval: ToolApproval }>;
    }
  | { status: "error"; code: DiagnosticCode }
);

const timestamps = {
  checkedAt: z.string().datetime(),
  serverUpdatedAt: z.string(),
};
export const diagnosticResultSchema: z.ZodType<McpDiagnosticResult> =
  z.discriminatedUnion("status", [
    z.object({
      ...timestamps,
      status: z.literal("success"),
      enabled: z.boolean(),
      tools: z.array(
        z.object({
          name: z.string(),
          approval: z.enum(["auto", "approve", "prompt", "deny"]),
        })
      ),
    }),
    z.object({
      ...timestamps,
      status: z.literal("error"),
      code: z.custom<DiagnosticCode>(
        (value) =>
          typeof value === "string" && Object.hasOwn(diagnosticMessages, value)
      ),
    }),
  ]);
