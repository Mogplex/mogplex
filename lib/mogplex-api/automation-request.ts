import { z } from "zod";
import type { FlowGraph } from "@/lib/types";
import {
  AGENT_ROLES,
  TRIGGER_EVENTS,
} from "@/lib/flows/assistant-tools-constants";

const finiteNumber = z.number().finite();

const startDataSchema = z
  .object({
    event: z.enum(TRIGGER_EVENTS),
    scheduleCron: z.string().optional(),
    scheduleTimezone: z.string().optional(),
    filter: z
      .object({
        scope: z.enum(["all", "org", "personal"]),
        installationIds: z.array(z.number().int().positive().safe()).optional(),
        repos: z.array(z.string()).optional(),
        authorFilter: z
          .enum(["any", "humans_only", "exclude_dependabot", "dependabot_only"])
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const agentDataSchema = z
  .object({
    agentId: z.string().nullable().optional(),
    harness: z.enum(["mogplex", "claude-code", "codex"]).optional(),
    role: z.enum(AGENT_ROLES).optional(),
    modelOverride: z.string().nullable().optional(),
    fallbackModelOverride: z.string().nullable().optional(),
    systemPromptOverride: z.string().nullable().optional(),
    timeoutMsOverride: finiteNumber.positive().nullable().optional(),
    autofix: z.boolean().optional(),
    autofixSandbox: z.boolean().optional(),
    autoMerge: z.boolean().optional(),
    autoRevert: z.boolean().optional(),
    requireApproval: z.boolean().optional(),
  })
  .passthrough();

const flowNodeSchema = z
  .object({
    id: z.string().trim().min(1),
    type: z.enum([
      "start",
      "agent",
      "action",
      "condition",
      "classify",
      "parallel",
      "join",
      "delay",
      "await_event",
      "set_variable",
      "transform",
      "end",
    ]),
    position: z.object({ x: finiteNumber, y: finiteNumber }).strict(),
    data: z.record(z.string(), z.unknown()),
  })
  .passthrough()
  .superRefine((node, ctx) => {
    const schema =
      node.type === "start"
        ? startDataSchema
        : node.type === "agent"
          ? agentDataSchema
          : null;
    if (!schema) return;
    const result = schema.safeParse(node.data);
    if (!result.success) {
      for (const issue of result.error.issues)
        ctx.addIssue({ ...issue, path: ["data", ...issue.path] });
    }
  });

const flowEdgeSchema = z
  .object({
    id: z.string().trim().min(1),
    source: z.string().trim().min(1),
    target: z.string().trim().min(1),
    sourceHandle: z.string().nullable().optional(),
    targetHandle: z.string().nullable().optional(),
  })
  .passthrough();

export const flowGraphPayloadSchema = z
  .object({
    nodes: z.array(flowNodeSchema),
    edges: z.array(flowEdgeSchema),
    viewport: z
      .object({
        x: finiteNumber,
        y: finiteNumber,
        zoom: finiteNumber.positive(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .transform((graph): FlowGraph => graph as FlowGraph);

export function parseOptionalFlowGraph(
  body: Record<string, unknown>
): { ok: true; graph: FlowGraph | undefined } | { ok: false; message: string } {
  if (!("graph" in body)) {
    return { ok: true, graph: undefined };
  }

  const parsed = flowGraphPayloadSchema.safeParse(body.graph);
  if (parsed.success) {
    return { ok: true, graph: parsed.data };
  }

  const issue = parsed.error.issues[0];
  const path = issue?.path.length ? ` at graph.${issue.path.join(".")}` : "";
  return {
    ok: false,
    message: `graph must be a valid Flow graph${path}`,
  };
}
