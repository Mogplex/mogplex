import { z } from "zod";

export const toolPolicySchema = z.object({
  enabled_tools: z.array(z.string()).optional(),
  disabled_tools: z.array(z.string()).optional(),
  default_tools_approval_mode: z.enum(["auto", "approve", "prompt"]).optional(),
  tools: z
    .record(
      z.string(),
      z.object({
        enabled: z.boolean().optional(),
        approval_mode: z.enum(["auto", "approve", "prompt", "deny"]).optional(),
      })
    )
    .optional(),
});

export type ToolPolicy = z.infer<typeof toolPolicySchema>;
export type ToolApproval = "auto" | "approve" | "prompt" | "deny";

export function normalizeToolNames(names: string[]): string[] {
  return [...new Set(names.map((name) => name.trim()).filter(Boolean))];
}

export function readToolPolicy(extra: unknown): ToolPolicy {
  return toolPolicySchema.parse(extra ?? {});
}

export function toolApproval(policy: ToolPolicy, name: string): ToolApproval {
  if (policy.enabled_tools && !policy.enabled_tools.includes(name))
    return "deny";
  if (policy.disabled_tools?.includes(name)) return "deny";
  const perTool = policy.tools?.[name];
  if (perTool?.enabled === false) return "deny";
  // CLI approval.ts defines "approve" as pre-approved, equivalent to "auto".
  return perTool?.approval_mode ?? policy.default_tools_approval_mode ?? "auto";
}

// Update the original object, not Zod's projection: preserve unknown CLI fields.
export function updateToolPolicy(
  extra: Record<string, unknown>,
  change: { tool?: string; mode: ToolApproval | "inherit" }
): Record<string, unknown> {
  readToolPolicy(extra);
  if (change.tool === undefined) {
    if (change.mode === "deny" || change.mode === "inherit")
      throw new Error("Invalid default permission");
    return { ...extra, default_tools_approval_mode: change.mode };
  }
  const tools = (extra.tools ?? {}) as Record<string, Record<string, unknown>>;
  const entry = { ...tools[change.tool] };
  if (change.mode === "inherit") delete entry.approval_mode;
  else entry.approval_mode = change.mode;
  return { ...extra, tools: { ...tools, [change.tool]: entry } };
}
