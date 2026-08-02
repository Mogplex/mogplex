import type {
  FlowAgentNodeData,
  FlowConditionOperator,
  FlowEdge,
  FlowGraph,
  FlowNode,
  FlowNodeType,
  TriggerEvent,
} from "@/lib/types";
import { FLOW_OPERATOR_REGISTRY } from "@/lib/flows/operators/registry";
import {
  eventLabel,
  FAILURE_HANDLE_ID,
  getDefaultFlowAgentRole,
} from "@/lib/flows/graph-helpers";
import { DEFAULT_NEW_AGENT_MODEL_ID } from "@/lib/agents/model-options";

export {
  CONDITION_HANDLE_IDS,
  CONDITION_OPERATORS,
  FAILURE_HANDLE_ID,
  FLOW_AGENT_ROLE_OPTIONS,
  FLOW_CONDITION_FIELD_PRESETS,
  VALUE_LESS_CONDITION_OPERATORS,
  conditionOperatorLabel,
  eventLabel,
  flowAgentHarnessLabel,
  flowAgentRoleLabel,
  getDefaultFlowAgentRole,
  getDelayNodeMs,
  getFailureEdges,
  hasUpstreamAgentRole,
  isCommentTriggerEvent,
  isConditionOperator,
  isFailureTokenPayload,
  isFlowAgentHarness,
  isFlowAgentNodeRole,
} from "@/lib/flows/graph-helpers";

export const DEFAULT_FLOW_VIEWPORT = { x: 0, y: 0, zoom: 1 };

// Agent nodes carry their own model, and publish rejects one without it, so a
// new graph has to be born with a model rather than inheriting an agent's.
// Callers that know the user's preference should pass it; DEFAULT_NEW_AGENT_MODEL_ID
// keeps a graph built without one publishable instead of dead on arrival.
export function createDefaultFlowGraph(input?: {
  event?: TriggerEvent;
  isDefault?: boolean;
  agentId?: string | null;
  agentName?: string | null;
  modelId?: string | null;
}): FlowGraph {
  const event = input?.event ?? "mention";
  const agentName = input?.agentName?.trim() || "Agent";
  const modelId = input?.modelId?.trim() || DEFAULT_NEW_AGENT_MODEL_ID;

  return {
    nodes: [
      {
        id: "start",
        type: "start",
        position: { x: 80, y: 140 },
        data: {
          label: eventLabel(event),
          event,
          isDefault: input?.isDefault ?? event === "mention",
        },
      },
      {
        id: "agent-1",
        type: "agent",
        position: { x: 360, y: 140 },
        data: {
          label: agentName,
          agentId: input?.agentId ?? null,
          harness: "mogplex",
          role: getDefaultFlowAgentRole(event),
          modelOverride: modelId,
          maxStepsOverride: null,
          timeoutMsOverride: null,
          systemPromptOverride: null,
        } satisfies FlowAgentNodeData,
      },
      {
        id: "end",
        type: "end",
        position: { x: 640, y: 140 },
        data: {
          label: "Done",
        },
      },
    ],
    edges: [
      { id: "start-agent-1", source: "start", target: "agent-1" },
      { id: "agent-1-end", source: "agent-1", target: "end" },
    ],
    viewport: DEFAULT_FLOW_VIEWPORT,
  };
}

export function cloneFlowGraph(graph: FlowGraph): FlowGraph {
  return {
    nodes: graph.nodes.map((node) => ({
      ...node,
      position: { ...node.position },
      data: { ...node.data },
    })) as FlowNode[],
    edges: graph.edges.map((edge) => ({ ...edge })),
    viewport: graph.viewport
      ? { ...graph.viewport }
      : { ...DEFAULT_FLOW_VIEWPORT },
  };
}

export function getNodeById(graph: FlowGraph, nodeId: string) {
  return graph.nodes.find((node) => node.id === nodeId) ?? null;
}

export function getStartNode(graph: FlowGraph) {
  return graph.nodes.find((node) => node.type === "start") ?? null;
}

export function getEndNode(graph: FlowGraph) {
  return graph.nodes.find((node) => node.type === "end") ?? null;
}

export function getAgentNodes(graph: FlowGraph) {
  return graph.nodes.filter(
    (node): node is Extract<FlowNode, { type: "agent" }> =>
      node.type === "agent"
  );
}

export function getOutgoingEdges(graph: FlowGraph, nodeId: string) {
  return graph.edges.filter((edge) => edge.source === nodeId);
}

export function getIncomingEdges(graph: FlowGraph, nodeId: string) {
  return graph.edges.filter((edge) => edge.target === nodeId);
}

export function getPrimaryAgentId(graph: FlowGraph) {
  const start = getStartNode(graph);
  if (!start) return null;

  const firstTarget = getOutgoingEdges(graph, start.id)
    .map((edge) => getNodeById(graph, edge.target))
    .find(
      (node): node is Extract<FlowNode, { type: "agent" }> =>
        node?.type === "agent"
    );

  return (
    firstTarget?.data.agentId ?? getAgentNodes(graph)[0]?.data.agentId ?? null
  );
}

export function getEntryAgentIds(graph: FlowGraph) {
  const start = getStartNode(graph);
  if (!start) return [];

  const entryAgentIds = getOutgoingEdges(graph, start.id)
    .map((edge) => getNodeById(graph, edge.target))
    .filter(
      (node): node is Extract<FlowNode, { type: "agent" }> =>
        node?.type === "agent"
    )
    .map((node) => node.data.agentId)
    .filter(
      (agentId): agentId is string =>
        typeof agentId === "string" && agentId.length > 0
    );

  return Array.from(new Set(entryAgentIds));
}

export function getStartConfig(graph: FlowGraph) {
  const start = getStartNode(graph);
  if (!start) return null;

  return {
    event: start.data.event,
    isDefault: start.data.isDefault === true,
    filter: start.data.filter,
    labelName: start.data.labelName,
    labelPrOnly: start.data.labelPrOnly,
    tagPattern: start.data.tagPattern,
    scheduleCron: start.data.scheduleCron,
    scheduleTimezone: start.data.scheduleTimezone,
    slackTeamId: start.data.slackTeamId,
    slackChannelId: start.data.slackChannelId,
    slackChannelName: start.data.slackChannelName,
  };
}

function buildAdjacency(graph: FlowGraph) {
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();

  for (const node of graph.nodes) {
    outgoing.set(node.id, []);
    incoming.set(node.id, []);
  }

  for (const edge of graph.edges) {
    outgoing.get(edge.source)?.push(edge.target);
    incoming.get(edge.target)?.push(edge.source);
  }

  return { outgoing, incoming };
}

function reachableFrom(startId: string, outgoing: Map<string, string[]>) {
  const seen = new Set<string>();
  const queue = [startId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const next of outgoing.get(current) || []) {
      if (!seen.has(next)) queue.push(next);
    }
  }

  return seen;
}

function reverseReachableFrom(endId: string, incoming: Map<string, string[]>) {
  const seen = new Set<string>();
  const queue = [endId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const prev of incoming.get(current) || []) {
      if (!seen.has(prev)) queue.push(prev);
    }
  }

  return seen;
}

function parseNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function splitListValue(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function rawIsEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

export function evaluateConditionRule(input: {
  rule: { field: string; operator: FlowConditionOperator; value: string };
  state: Record<string, unknown>;
}): boolean {
  const { rule, state } = input;
  const rawValue = resolveFieldPath(state, rule.field);
  const compareValue = rule.value;

  switch (rule.operator) {
    case "exists":
      return (
        rawValue !== undefined &&
        rawValue !== null &&
        String(rawValue).length > 0
      );
    case "is_empty":
      return rawIsEmpty(rawValue);
    case "is_not_empty":
      return !rawIsEmpty(rawValue);
    case "equals":
      return String(rawValue ?? "") === compareValue;
    case "not_equals":
      return String(rawValue ?? "") !== compareValue;
    case "contains": {
      if (Array.isArray(rawValue)) {
        return rawValue.some(
          (entry) => String(entry).toLowerCase() === compareValue.toLowerCase()
        );
      }
      return String(rawValue ?? "")
        .toLowerCase()
        .includes(compareValue.toLowerCase());
    }
    case "not_contains": {
      if (Array.isArray(rawValue)) {
        return !rawValue.some(
          (entry) => String(entry).toLowerCase() === compareValue.toLowerCase()
        );
      }
      return !String(rawValue ?? "")
        .toLowerCase()
        .includes(compareValue.toLowerCase());
    }
    case "starts_with":
      return String(rawValue ?? "")
        .toLowerCase()
        .startsWith(compareValue.toLowerCase());
    case "ends_with":
      return String(rawValue ?? "")
        .toLowerCase()
        .endsWith(compareValue.toLowerCase());
    case "greater_than": {
      const left = parseNumber(String(rawValue ?? ""));
      const right = parseNumber(compareValue);
      return left != null && right != null && left > right;
    }
    case "less_than": {
      const left = parseNumber(String(rawValue ?? ""));
      const right = parseNumber(compareValue);
      return left != null && right != null && left < right;
    }
    case "in": {
      const haystack = splitListValue(compareValue).map((entry) =>
        entry.toLowerCase()
      );
      const needle = String(rawValue ?? "").toLowerCase();
      return haystack.includes(needle);
    }
    case "not_in": {
      const haystack = splitListValue(compareValue).map((entry) =>
        entry.toLowerCase()
      );
      const needle = String(rawValue ?? "").toLowerCase();
      return !haystack.includes(needle);
    }
  }
}

export function evaluateConditionNode(input: {
  node: Extract<FlowNode, { type: "condition" }>;
  state: Record<string, unknown>;
}): boolean {
  const { rules, mode } = input.node.data;
  if (rules.length === 0) return false;

  if (mode === "any") {
    return rules.some((rule) =>
      evaluateConditionRule({ rule, state: input.state })
    );
  }
  return rules.every((rule) =>
    evaluateConditionRule({ rule, state: input.state })
  );
}

export function resolveFieldPath(state: Record<string, unknown>, path: string) {
  if (!path) return;
  return path.split(".").reduce<unknown>((current, segment) => {
    if (current == null || typeof current !== "object") return;
    return (current as Record<string, unknown>)[segment];
  }, state);
}

// `requireRunnableConfig` gates every check that asks "could this graph
// actually execute as written" — an agent node must be bound to an agent AND
// (unless it is a harness node) must carry a model, since the node is the only
// source of a step's model. Team templates and other placeholder graphs pass
// false: they are edited into shape before anyone runs them. It was named
// `requireBoundAgents` when the agent binding was the only such check; anything
// added under this flag should be a runnability requirement, not a style one.
export function validateFlowGraph(
  graph: FlowGraph,
  options?: { requireRunnableConfig?: boolean }
) {
  const errors: string[] = [];
  const requireRunnableConfig = options?.requireRunnableConfig ?? true;
  const nodeIds = new Set<string>();

  for (const node of graph.nodes) {
    if (nodeIds.has(node.id)) {
      errors.push(`Duplicate node id "${node.id}".`);
    }
    nodeIds.add(node.id);
  }

  const startNodes = graph.nodes.filter((node) => node.type === "start");
  const endNodes = graph.nodes.filter((node) => node.type === "end");
  const agentNodes = getAgentNodes(graph);
  const autoMergeRequestNodes = graph.nodes.filter(
    (node) =>
      (node.type === "agent" && node.data.autoMerge === true) ||
      (node.type === "action" &&
        node.data.operation === "github.merge_pull_request")
  );

  if (startNodes.length !== 1)
    errors.push("A flow must have exactly one start node.");
  if (endNodes.length !== 1)
    errors.push("A flow must have exactly one end node.");
  if (agentNodes.length === 0)
    errors.push("A flow must contain at least one agent node.");
  if (autoMergeRequestNodes.length > 1)
    errors.push("A flow can request at most one pull request merge.");

  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      errors.push(`Edge "${edge.id}" references a missing node.`);
    }
    if (edge.source === edge.target) {
      errors.push(`Edge "${edge.id}" cannot connect a node to itself.`);
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const { outgoing, incoming } = buildAdjacency(graph);
  const start = startNodes[0]!;
  const end = endNodes[0]!;

  if ((incoming.get(start.id) || []).length > 0)
    errors.push("The start node cannot have incoming edges.");
  if ((outgoing.get(start.id) || []).length !== 1)
    errors.push("The start node must have exactly one outgoing edge.");
  if ((outgoing.get(end.id) || []).length > 0)
    errors.push("The end node cannot have outgoing edges.");

  for (const node of graph.nodes) {
    const inbound = getIncomingEdges(graph, node.id);
    const outbound = getOutgoingEdges(graph, node.id);
    const operator = FLOW_OPERATOR_REGISTRY[node.type];
    const operatorErrors = operator.validate?.({
      // The registry's per-operator validate is parameterized over a
      // discriminated union member; widen here because the loop visits every
      // node type.
      node: node as never,
      graph,
      inbound,
      outbound,
      startNode: start,
      options: { requireRunnableConfig },
    });
    if (operatorErrors && operatorErrors.length > 0) {
      errors.push(...operatorErrors);
    }

    const errorEdges = outbound.filter(
      (edge) => edge.sourceHandle === FAILURE_HANDLE_ID
    );
    if (errorEdges.length > 1) {
      errors.push(`Node "${node.data.label}" can have at most one error edge.`);
    }
    if (errorEdges.length > 0 && operator.canFail !== true) {
      errors.push(
        `Node "${node.data.label}" cannot have an error edge — its operator does not support failure recovery.`
      );
    }
  }

  const reachable = reachableFrom(start.id, outgoing);
  const canReachEnd = reverseReachableFrom(end.id, incoming);

  for (const node of graph.nodes) {
    if (!reachable.has(node.id)) {
      errors.push(
        `Node "${node.data.label}" is disconnected from the start node.`
      );
    } else if (!canReachEnd.has(node.id)) {
      errors.push(`Node "${node.data.label}" does not lead to the end node.`);
    }
  }

  const relevantNodeIds = graph.nodes
    .filter((node) => reachable.has(node.id) && canReachEnd.has(node.id))
    .map((node) => node.id);
  const relevantSet = new Set(relevantNodeIds);
  const inDegree = new Map<string, number>();

  for (const nodeId of relevantNodeIds) inDegree.set(nodeId, 0);
  for (const edge of graph.edges) {
    if (relevantSet.has(edge.source) && relevantSet.has(edge.target)) {
      inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
    }
  }

  const queue = relevantNodeIds.filter(
    (nodeId) => (inDegree.get(nodeId) || 0) === 0
  );
  let visited = 0;

  while (queue.length > 0) {
    const current = queue.shift()!;
    visited += 1;
    for (const next of outgoing.get(current) || []) {
      if (!relevantSet.has(next)) continue;
      inDegree.set(next, (inDegree.get(next) || 0) - 1);
      if ((inDegree.get(next) || 0) === 0) queue.push(next);
    }
  }

  if (visited !== relevantNodeIds.length) {
    errors.push("The flow graph contains a cycle.");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function buildExecutionLevels(graph: FlowGraph) {
  const validation = validateFlowGraph(graph);
  if (!validation.valid) {
    throw new Error(validation.errors[0] || "Invalid flow graph");
  }

  const { outgoing, incoming } = buildAdjacency(graph);
  const start = getStartNode(graph)!;
  const end = getEndNode(graph)!;
  const reachable = reachableFrom(start.id, outgoing);
  const canReachEnd = reverseReachableFrom(end.id, incoming);
  const relevantNodes = graph.nodes.filter(
    (node) => reachable.has(node.id) && canReachEnd.has(node.id)
  );
  const relevantIds = new Set(relevantNodes.map((node) => node.id));

  const inDegree = new Map<string, number>();
  for (const node of relevantNodes) inDegree.set(node.id, 0);
  for (const edge of graph.edges) {
    if (relevantIds.has(edge.source) && relevantIds.has(edge.target)) {
      inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
    }
  }

  let frontier = relevantNodes.filter(
    (node) => (inDegree.get(node.id) || 0) === 0
  );
  const levels: Array<Array<Extract<FlowNode, { type: "agent" }>>> = [];

  while (frontier.length > 0) {
    const currentLevel = frontier;
    const next: FlowNode[] = [];

    for (const node of currentLevel) {
      for (const targetId of outgoing.get(node.id) || []) {
        if (!relevantIds.has(targetId)) continue;
        inDegree.set(targetId, (inDegree.get(targetId) || 0) - 1);
        if ((inDegree.get(targetId) || 0) === 0) {
          const targetNode = relevantNodes.find(
            (candidate) => candidate.id === targetId
          );
          if (targetNode) next.push(targetNode);
        }
      }
    }

    const agentNodes = currentLevel.filter(
      (node): node is Extract<FlowNode, { type: "agent" }> =>
        node.type === "agent"
    );
    if (agentNodes.length > 0) levels.push(agentNodes);
    frontier = next;
  }

  return levels;
}

export function listPredecessorOutputs(
  graph: FlowGraph,
  nodeId: string,
  outputs: Map<string, { label: string; text: string }>
) {
  return graph.edges
    .filter((edge) => edge.target === nodeId)
    .map((edge) => outputs.get(edge.source))
    .filter(Boolean) as Array<{ label: string; text: string }>;
}

export function summarizeNodeOutput(value: string) {
  const trimmed = value.trim();
  if (trimmed.length <= 600) return trimmed;
  return `${trimmed.slice(0, 597)}...`;
}

export function coerceGraph(input: unknown): FlowGraph {
  if (!input || typeof input !== "object") {
    return {
      nodes: [],
      edges: [],
      viewport: { ...DEFAULT_FLOW_VIEWPORT },
    };
  }

  const record = input as Record<string, unknown>;
  const nodes = Array.isArray(record.nodes) ? record.nodes : [];
  const edges = Array.isArray(record.edges) ? record.edges : [];

  return {
    nodes: nodes.flatMap((node): FlowNode[] => {
      if (!node || typeof node !== "object") return [];
      const raw = node as Record<string, unknown>;
      const type = raw.type as FlowNodeType;
      const operator = FLOW_OPERATOR_REGISTRY[type];
      if (!operator) return [];
      const positionRecord =
        raw.position && typeof raw.position === "object"
          ? (raw.position as Record<string, unknown>)
          : {};
      const data =
        raw.data && typeof raw.data === "object"
          ? (raw.data as Record<string, unknown>)
          : {};
      return [
        {
          id: String(raw.id ?? crypto.randomUUID()),
          type,
          position: {
            x: Number(positionRecord.x ?? 0),
            y: Number(positionRecord.y ?? 0),
          },
          data: operator.coerceData(data),
        } as FlowNode,
      ];
    }),
    edges: edges.flatMap((edge): FlowEdge[] => {
      if (!edge || typeof edge !== "object") return [];
      const raw = edge as Record<string, unknown>;
      return [
        {
          id: String(raw.id ?? `${raw.source}-${raw.target}`),
          source: String(raw.source ?? ""),
          target: String(raw.target ?? ""),
          sourceHandle:
            typeof raw.sourceHandle === "string" ? raw.sourceHandle : null,
          targetHandle:
            typeof raw.targetHandle === "string" ? raw.targetHandle : null,
        },
      ];
    }),
    viewport:
      record.viewport && typeof record.viewport === "object"
        ? {
            x: Number((record.viewport as Record<string, unknown>).x ?? 0),
            y: Number((record.viewport as Record<string, unknown>).y ?? 0),
            zoom: Number(
              (record.viewport as Record<string, unknown>).zoom ?? 1
            ),
          }
        : { ...DEFAULT_FLOW_VIEWPORT },
  };
}
