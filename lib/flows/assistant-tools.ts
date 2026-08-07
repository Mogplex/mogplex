import type { Tool } from "ai";
import { FLOW_ASSISTANT_GRAPH_STATE_TOOL } from "@/lib/flows/assistant-chat-payload";
import { cloneFlowGraph, createDefaultFlowGraph } from "@/lib/flows/graph";
import { DEFAULT_NEW_AGENT_MODEL_ID } from "@/lib/agents/model-options";
import type { FlowGraph, FlowNodeType } from "@/lib/types";
import type { ToolContext } from "./assistant-tools-node-factories";
import type { GraphToolContext } from "./assistant-tools-graph-factories";
import {
  createSetStartTool,
  createSetEndTool,
  createAddAgentNodeTool,
  createAddConditionNodeTool,
  createAddParallelNodeTool,
  createAddJoinNodeTool,
  createAddDelayNodeTool,
  createAddAwaitEventNodeTool,
  createAddSetVariableNodeTool,
  createAddTransformNodeTool,
} from "./assistant-tools-node-factories";
import {
  createAddRunCommandNodeTool,
  createAddSlackMessageNodeTool,
  createAddGithubCommentNodeTool,
  createAddGithubIssueNodeTool,
  createAddGithubLabelsNodeTool,
  createAddGithubStatusNodeTool,
  createAddGithubReviewNodeTool,
  createAddGithubMergeNodeTool,
} from "./assistant-tools-action-factories";
import {
  createConnectTool,
  createDisconnectTool,
  createRemoveNodeTool,
  createUpdateNodeLabelTool,
  createGetGraphTool,
  createGetGraphStateTool,
  createFinalizeTool,
} from "./assistant-tools-graph-factories";

type AllowedAgent = { id: string; name: string; slug: string };

export type FlowAssistantResult = {
  done: boolean;
  summary: string | null;
  graph: FlowGraph;
  hydrated: boolean;
};

export type FlowAssistantToolset = {
  tools: Record<string, Tool>;
  getResult: () => FlowAssistantResult;
};

function randomId() {
  return crypto.randomUUID().slice(0, 8);
}

export function createFlowAssistantTools(input: {
  initialGraph: FlowGraph | null;
  allowedAgents: AllowedAgent[];
  allowedModelIds?: readonly string[];
  includeGraphStateTool?: boolean;
}): FlowAssistantToolset {
  const graph: FlowGraph = cloneFlowGraph(
    input.initialGraph ?? createDefaultFlowGraph()
  );
  const graphHydrated = input.initialGraph !== null;
  const allowedAgentIds = new Set(input.allowedAgents.map((a) => a.id));
  const allowedModelIds = new Set<string>(input.allowedModelIds);
  const defaultModelId = allowedModelIds.has(DEFAULT_NEW_AGENT_MODEL_ID)
    ? DEFAULT_NEW_AGENT_MODEL_ID
    : (input.allowedModelIds?.[0] ?? DEFAULT_NEW_AGENT_MODEL_ID);
  let finalizedSummary: string | null = null;

  const mintId = (type: FlowNodeType) => `${type}-${randomId()}`;
  const mintEdgeId = () => `edge-${randomId()}`;

  const autoPosition = () => {
    const count = graph.nodes.length;
    return { x: 80 + count * 220, y: 140 };
  };

  const findNode = (id: string) => graph.nodes.find((n) => n.id === id);

  const removeNodeById = (id: string) => {
    const exists = findNode(id);
    if (!exists) return false;
    graph.nodes = graph.nodes.filter((n) => n.id !== id);
    graph.edges = graph.edges.filter((e) => e.source !== id && e.target !== id);
    return true;
  };

  function removeNodeByType(type: "start" | "end") {
    graph.nodes = graph.nodes.filter((n) => n.type !== type);
    const remainingIds = new Set(graph.nodes.map((n) => n.id));
    graph.edges = graph.edges.filter(
      (e) => remainingIds.has(e.source) && remainingIds.has(e.target)
    );
  }

  const requireGraphHydrated = () => {
    if (graphHydrated) return null;
    return {
      error:
        "Call getGraphState first so the live canvas graph can be loaded before editing.",
    };
  };

  const setFinalizedSummary = (summary: string) => {
    finalizedSummary = summary;
  };

  const ctx: ToolContext = {
    graph,
    graphHydrated,
    allowedAgentIds,
    allowedModelIds,
    defaultModelId,
    mintId,
    autoPosition,
    requireGraphHydrated,
    removeNodeByType,
  };

  const graphCtx: GraphToolContext = {
    ...ctx,
    findNode,
    removeNodeById,
    mintEdgeId,
    setFinalizedSummary,
  };

  const tools: Record<string, Tool> = {
    setStart: createSetStartTool(ctx),
    setEnd: createSetEndTool(ctx),
    addAgentNode: createAddAgentNodeTool(ctx),
    addConditionNode: createAddConditionNodeTool(ctx),
    addParallelNode: createAddParallelNodeTool(ctx),
    addJoinNode: createAddJoinNodeTool(ctx),
    addDelayNode: createAddDelayNodeTool(ctx),
    addAwaitEventNode: createAddAwaitEventNodeTool(ctx),
    addSetVariableNode: createAddSetVariableNodeTool(ctx),
    addTransformNode: createAddTransformNodeTool(ctx),
    addRunCommandNode: createAddRunCommandNodeTool(ctx),
    addSlackMessageNode: createAddSlackMessageNodeTool(ctx),
    addGithubCommentNode: createAddGithubCommentNodeTool(ctx),
    addGithubIssueNode: createAddGithubIssueNodeTool(ctx),
    addGithubLabelsNode: createAddGithubLabelsNodeTool(ctx),
    addGithubStatusNode: createAddGithubStatusNodeTool(ctx),
    addGithubReviewNode: createAddGithubReviewNodeTool(ctx),
    addGithubMergeNode: createAddGithubMergeNodeTool(ctx),
    connect: createConnectTool(graphCtx),
    disconnect: createDisconnectTool(graphCtx),
    removeNode: createRemoveNodeTool(graphCtx),
    updateNodeLabel: createUpdateNodeLabelTool(graphCtx),
    getGraph: createGetGraphTool(graphCtx),
    finalize: createFinalizeTool(graphCtx),
  };
  if (input.includeGraphStateTool) {
    tools[FLOW_ASSISTANT_GRAPH_STATE_TOOL] = createGetGraphStateTool();
  }

  return {
    tools,
    getResult: () => ({
      done: finalizedSummary !== null,
      summary: finalizedSummary,
      graph: cloneFlowGraph(graph),
      hydrated: graphHydrated,
    }),
  };
}
