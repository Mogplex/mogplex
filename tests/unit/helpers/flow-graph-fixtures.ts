import type {
  FlowOperatorEmittedToken,
  FlowOperatorExecuteContext,
} from "../../../lib/flows/operators/types";
import type { FlowGraph, FlowNode } from "../../../lib/types";

export type JoinNode = Extract<FlowNode, { type: "join" }>;
export type SetVariableNode = Extract<FlowNode, { type: "set_variable" }>;
export type TransformNode = Extract<FlowNode, { type: "transform" }>;

export type CompletedNodeRun = {
  status: "success" | "failed" | "skipped" | "cancelled";
  output?: Record<string, unknown> | null;
  error?: string | null;
};

export function makeToken(
  fromNodeId: string,
  label: string,
  skipped = false
): FlowOperatorEmittedToken {
  return {
    fromNodeId,
    label,
    text: skipped ? "" : `${label} output`,
    skipped,
    payload: null,
  };
}

export function buildJoinTestGraph(
  policy: "wait_for_all" | "wait_for_any" | "quorum",
  quorum: number | null,
  branchCount: number
): { graph: FlowGraph; joinNode: JoinNode } {
  const nodes: FlowNode[] = [
    {
      id: "join-1",
      type: "join",
      position: { x: 0, y: 0 },
      data: { label: "Merge", policy, quorum },
    },
    {
      id: "end",
      type: "end",
      position: { x: 0, y: 0 },
      data: { label: "Done" },
    },
  ];
  const edges = [
    { id: "edge-join-end", source: "join-1", target: "end" },
  ] as FlowGraph["edges"];
  for (let index = 0; index < branchCount; index += 1) {
    const branchId = `branch-${index}`;
    nodes.push({
      id: branchId,
      type: "agent",
      position: { x: 0, y: 0 },
      data: { label: `Branch ${index}`, agentId: `agent-${index}` },
    });
    edges.push({
      id: `edge-${branchId}-join`,
      source: branchId,
      target: "join-1",
    });
  }
  const joinNode = nodes.find((node) => node.id === "join-1") as JoinNode;
  return {
    graph: { nodes, edges, viewport: { x: 0, y: 0, zoom: 1 } },
    joinNode,
  };
}

export function buildExecuteContext(
  graph: FlowGraph,
  joinNode: JoinNode,
  inboundTokens: FlowOperatorEmittedToken[]
): {
  ctx: FlowOperatorExecuteContext<JoinNode>;
  completed: CompletedNodeRun[];
  emitted: Array<{ targetId: string; token: FlowOperatorEmittedToken }>;
} {
  const completed: CompletedNodeRun[] = [];
  const emitted: Array<{ targetId: string; token: FlowOperatorEmittedToken }> =
    [];
  const activeInboundTokens = inboundTokens.filter((token) => !token.skipped);
  const shouldSkip =
    inboundTokens.length > 0 && activeInboundTokens.length === 0;
  const ctx: FlowOperatorExecuteContext<JoinNode> = {
    node: joinNode,
    label: joinNode.data.label,
    graph,
    inboundTokens,
    activeInboundTokens,
    shouldSkip,
    outputs: new Map(),
    flowState: new Map(),
    resolutionState: {},
    predecessorOutputs: () =>
      activeInboundTokens.map((token) => ({
        label: token.label,
        text: token.text,
      })),
    emit: (label, text, options) => {
      const skipped = options?.skipped ?? false;
      const outgoing = graph.edges.filter(
        (edge) => edge.source === joinNode.id
      );
      return outgoing.map((edge) => ({
        targetId: edge.target,
        token: {
          fromNodeId: joinNode.id,
          label,
          text,
          skipped,
          payload: options?.payload ?? null,
        },
      }));
    },
    completeNodeRun: async (completion) => {
      completed.push(completion);
      return 0;
    },
    completeSkipped: async (reason) => {
      completed.push({
        status: "skipped",
        output: { skipped: true, reason },
      });
      return {
        ok: true,
        emitted: [],
      };
    },
    jobRunId: "job-test",
    flowId: "flow-test",
    flowVersionId: null,
    userId: "user-test",
    installationId: null,
    repoId: null,
    waitProvider: {
      sleep: async () => {},
      createToken: async () => ({ id: "tok" }),
      waitForToken: async () => ({ ok: true, output: {} as never }),
    },
    waitStore: {
      createWait: async () => ({ id: "wait" }),
      finalizeWait: async () => {},
    },
    actionRunner: async () => ({ summary: "", output: {} }),
  };
  // Capture emit() output by wrapping
  const originalEmit = ctx.emit;
  ctx.emit = (label, text, options) => {
    const result = originalEmit(label, text, options);
    for (const e of result) emitted.push(e);
    return result;
  };
  return { ctx, completed, emitted };
}

export function buildJoinPolicyGraph(
  joinData: Record<string, unknown>
): FlowGraph {
  return {
    nodes: [
      {
        id: "start",
        type: "start",
        position: { x: 0, y: 0 },
        data: { label: "PR opened", event: "pr_opened" },
      },
      {
        id: "parallel",
        type: "parallel",
        position: { x: 200, y: 0 },
        data: { label: "Split" },
      },
      {
        id: "agent-a",
        type: "agent",
        position: { x: 400, y: -80 },
        data: {
          label: "A",
          agentId: "agent-a",
          modelOverride: "openai/gpt-5.4",
        },
      },
      {
        id: "agent-b",
        type: "agent",
        position: { x: 400, y: 80 },
        data: {
          label: "B",
          agentId: "agent-b",
          modelOverride: "openai/gpt-5.4",
        },
      },
      {
        id: "join",
        type: "join",
        position: { x: 600, y: 0 },
        data: joinData as never,
      },
      {
        id: "end",
        type: "end",
        position: { x: 800, y: 0 },
        data: { label: "Done" },
      },
    ],
    edges: [
      { id: "e1", source: "start", target: "parallel" },
      { id: "e2", source: "parallel", target: "agent-a" },
      { id: "e3", source: "parallel", target: "agent-b" },
      { id: "e4", source: "agent-a", target: "join" },
      { id: "e5", source: "agent-b", target: "join" },
      { id: "e6", source: "join", target: "end" },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

export function buildSetVariablePolicyGraph(
  data: Record<string, unknown>
): FlowGraph {
  return {
    nodes: [
      {
        id: "start",
        type: "start",
        position: { x: 0, y: 0 },
        data: { label: "Comment", event: "issue_comment" },
      },
      {
        id: "triage",
        type: "agent",
        position: { x: 150, y: 0 },
        data: {
          label: "Triage",
          agentId: "agent-1",
          role: "triage",
          modelOverride: "openai/gpt-5.4",
        },
      },
      {
        id: "set",
        type: "set_variable",
        position: { x: 300, y: 0 },
        data: data as SetVariableNode["data"],
      },
      {
        id: "end",
        type: "end",
        position: { x: 450, y: 0 },
        data: { label: "Done" },
      },
    ],
    edges: [
      { id: "e1", source: "start", target: "triage" },
      { id: "e2", source: "triage", target: "set" },
      { id: "e3", source: "set", target: "end" },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

export function buildTransformPolicyGraph(
  data: TransformNode["data"]
): FlowGraph {
  return {
    nodes: [
      {
        id: "start",
        type: "start",
        position: { x: 0, y: 0 },
        data: { label: "PR opened", event: "pr_opened" },
      },
      {
        id: "triage",
        type: "agent",
        position: { x: 150, y: 0 },
        data: {
          label: "Triage",
          agentId: "agent-1",
          role: "triage",
          modelOverride: "openai/gpt-5.4",
        },
      },
      {
        id: "transform",
        type: "transform",
        position: { x: 300, y: 0 },
        data,
      },
      {
        id: "end",
        type: "end",
        position: { x: 450, y: 0 },
        data: { label: "Done" },
      },
    ],
    edges: [
      { id: "e1", source: "start", target: "triage" },
      { id: "e2", source: "triage", target: "transform" },
      { id: "e3", source: "transform", target: "end" },
    ],
  };
}
