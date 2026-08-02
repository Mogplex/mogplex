import { z } from "zod";
import type { FlowGraph } from "@/lib/types";

const finiteNumber = z.number().finite();

const flowNodeSchema = z
  .object({
    id: z.string().trim().min(1),
    type: z.enum([
      "start",
      "agent",
      "condition",
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
  .passthrough();

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
