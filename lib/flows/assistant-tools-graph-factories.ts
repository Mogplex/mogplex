import { tool } from "ai";
import { z } from "zod";
import type { FlowGraph } from "@/lib/types";
import {
  cloneFlowGraph,
  FAILURE_HANDLE_ID,
  validateFlowGraph,
} from "@/lib/flows/graph";
import { FLOW_OPERATOR_REGISTRY } from "@/lib/flows/operators/registry";
import type { ToolContext } from "./assistant-tools-node-factories";
import {
  connectParams,
  disconnectParams,
  removeNodeParams,
  updateNodeLabelParams,
  getGraphParams,
  finalizeParams,
} from "./assistant-tools-schemas";

export type GraphToolContext = ToolContext & {
  findNode: (id: string) => FlowGraph["nodes"][number] | undefined;
  removeNodeById: (id: string) => boolean;
  mintEdgeId: () => string;
  setFinalizedSummary: (summary: string) => void;
};

export function createConnectTool(ctx: GraphToolContext) {
  return tool({
    description:
      "Create an edge between two existing nodes. For If (condition) sources pass sourceHandle as 'true' for the then branch or 'false' for the else branch. To route a recovery branch from a failure-aware node (agent, action, condition, delay, await_event, set_variable, transform), pass sourceHandle as 'error'.",
    inputSchema: connectParams,
    execute: async ({
      source,
      target,
      sourceHandle,
      targetHandle,
    }: z.infer<typeof connectParams>) => {
      const hydrationError = ctx.requireGraphHydrated();
      if (hydrationError) return hydrationError;
      const sourceNode = ctx.findNode(source);
      if (!sourceNode) return { error: `No node with id "${source}".` };
      if (!ctx.findNode(target)) {
        return { error: `No node with id "${target}".` };
      }
      if (source === target)
        return { error: "A node cannot connect to itself." };
      if (sourceHandle === FAILURE_HANDLE_ID) {
        const operator = FLOW_OPERATOR_REGISTRY[sourceNode.type];
        if (operator?.canFail !== true) {
          return {
            error: `Node "${source}" cannot have an error edge — its operator does not support failure recovery.`,
          };
        }
        const existingErrorEdge = ctx.graph.edges.find(
          (e) => e.source === source && e.sourceHandle === FAILURE_HANDLE_ID
        );
        if (existingErrorEdge) {
          return {
            error: `Node "${source}" already has an error edge (id "${existingErrorEdge.id}").`,
          };
        }
      }
      const normalizedSourceHandle = sourceHandle ?? null;
      const normalizedTargetHandle = targetHandle ?? null;
      const duplicate = ctx.graph.edges.some(
        (e) =>
          e.source === source &&
          e.target === target &&
          (e.sourceHandle ?? null) === normalizedSourceHandle &&
          (e.targetHandle ?? null) === normalizedTargetHandle
      );
      if (duplicate) {
        return {
          error: `Edge from "${source}" to "${target}" already exists.`,
        };
      }
      const id = ctx.mintEdgeId();
      ctx.graph.edges.push({
        id,
        source,
        target,
        sourceHandle: normalizedSourceHandle,
        targetHandle: normalizedTargetHandle,
      });
      return { id };
    },
  });
}

export function createDisconnectTool(ctx: GraphToolContext) {
  return tool({
    description: "Remove an edge by id.",
    inputSchema: disconnectParams,
    execute: async ({ edgeId }: z.infer<typeof disconnectParams>) => {
      const hydrationError = ctx.requireGraphHydrated();
      if (hydrationError) return hydrationError;
      const before = ctx.graph.edges.length;
      ctx.graph.edges = ctx.graph.edges.filter((e) => e.id !== edgeId);
      if (ctx.graph.edges.length === before) {
        return { error: `No edge with id "${edgeId}".` };
      }
      return { ok: true };
    },
  });
}

export function createRemoveNodeTool(ctx: GraphToolContext) {
  return tool({
    description:
      "Remove a node and all edges connected to it. Cannot remove nodes with id 'start' or 'end' — call setStart/setEnd instead.",
    inputSchema: removeNodeParams,
    execute: async ({ id }: z.infer<typeof removeNodeParams>) => {
      const hydrationError = ctx.requireGraphHydrated();
      if (hydrationError) return hydrationError;
      if (id === "start" || id === "end") {
        return {
          error: "Use setStart/setEnd to replace the start or end node.",
        };
      }
      const ok = ctx.removeNodeById(id);
      if (!ok) return { error: `No node with id "${id}".` };
      return { ok: true };
    },
  });
}

export function createUpdateNodeLabelTool(ctx: GraphToolContext) {
  return tool({
    description: "Change the label of an existing node.",
    inputSchema: updateNodeLabelParams,
    execute: async ({ id, label }: z.infer<typeof updateNodeLabelParams>) => {
      const hydrationError = ctx.requireGraphHydrated();
      if (hydrationError) return hydrationError;
      const node = ctx.findNode(id);
      if (!node) return { error: `No node with id "${id}".` };
      node.data = { ...node.data, label };
      return { ok: true };
    },
  });
}

export function createGetGraphTool(ctx: GraphToolContext) {
  return tool({
    description:
      "Return the current working graph as JSON. Call this whenever you need to inspect state before making changes.",
    inputSchema: getGraphParams,
    execute: async () => {
      const hydrationError = ctx.requireGraphHydrated();
      if (hydrationError) return hydrationError;
      return { graph: cloneFlowGraph(ctx.graph) };
    },
  });
}

export function createGetGraphStateTool() {
  return tool({
    description:
      "Request the live canvas graph from the client. Call this before inspecting or editing the graph in chat.",
    inputSchema: getGraphParams,
    outputSchema: z.object({ graph: z.unknown() }),
  });
}

export function createFinalizeTool(ctx: GraphToolContext) {
  return tool({
    description:
      "Validate the graph and finish. On validation errors, fix them with other tools and call finalize again. On success, the flow is saved as the assistant's suggestion.",
    inputSchema: finalizeParams,
    execute: async ({ summary }: z.infer<typeof finalizeParams>) => {
      const hydrationError = ctx.requireGraphHydrated();
      if (hydrationError) return hydrationError;
      const validation = validateFlowGraph(ctx.graph, {
        requireRunnableConfig: true,
      });
      if (!validation.valid) {
        return { ok: false, errors: validation.errors };
      }
      ctx.setFinalizedSummary(summary);
      return { ok: true };
    },
  });
}
