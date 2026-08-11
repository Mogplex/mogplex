import type { FlowNode } from "@/lib/types";
import {
  hasUpstreamAgentRole,
  isCommentTriggerEvent,
  isFlowAgentHarness,
  isFlowAgentNodeRole,
} from "@/lib/flows/graph-helpers";
import type { FlowOperatorDefinition } from "./types";

type AgentNode = Extract<FlowNode, { type: "agent" }>;

export const agentOperator: FlowOperatorDefinition<AgentNode> = {
  type: "agent",
  canFail: true,
  validate: ({ node, graph, inbound, outbound, startNode, options }) => {
    const errors: string[] = [];
    if (inbound.length === 0)
      errors.push(`Agent "${node.data.label}" must have an incoming edge.`);
    if (outbound.length === 0)
      errors.push(`Agent "${node.data.label}" must have an outgoing edge.`);
    if (
      options.requireRunnableConfig &&
      (node.data.harness ?? "mogplex") === "mogplex" &&
      !node.data.agentId
    ) {
      errors.push(
        `Agent node "${node.data.label}" must be assigned to an agent.`
      );
    }
    // The node is the only source of truth for which model a step runs on, so
    // a mogplex-harness node without one is unrunnable. Harness nodes are
    // exempt: claude-code/codex invoke their own CLI, which picks its model.
    if (
      options.requireRunnableConfig &&
      (node.data.harness ?? "mogplex") === "mogplex" &&
      !node.data.modelOverride?.trim()
    ) {
      errors.push(
        `Agent node "${node.data.label}" must have a model selected.`
      );
    }
    if (
      node.data.role === "edit" &&
      !hasUpstreamAgentRole(graph, node.id, "review") &&
      !isCommentTriggerEvent(startNode.data.event)
    ) {
      errors.push(
        `Fix node "${node.data.label}" must be placed after a Review node, or its flow must start from a pull request comment trigger (@mogplex mention or PR comment).`
      );
    }
    return errors;
  },
  coerceData: (raw) => ({
    label: String(raw.label ?? "Agent"),
    agentId:
      typeof raw.agentId === "string" && raw.agentId.length > 0
        ? raw.agentId
        : null,
    harness: isFlowAgentHarness(raw.harness) ? raw.harness : "mogplex",
    role: isFlowAgentNodeRole(raw.role) ? raw.role : "review",
    autofix: raw.autofix === true,
    autofixSandbox: raw.autofixSandbox === true,
    autoMerge: raw.autoMerge === true,
    autoRevert: raw.autoRevert === true,
    requireApproval: raw.requireApproval === true,
    modelOverride:
      typeof raw.modelOverride === "string" && raw.modelOverride.length > 0
        ? raw.modelOverride
        : null,
    fallbackModelOverride:
      typeof raw.fallbackModelOverride === "string" &&
      raw.fallbackModelOverride.length > 0
        ? raw.fallbackModelOverride
        : null,
    maxStepsOverride:
      typeof raw.maxStepsOverride === "number" &&
      Number.isFinite(raw.maxStepsOverride)
        ? raw.maxStepsOverride
        : null,
    timeoutMsOverride:
      typeof raw.timeoutMsOverride === "number" &&
      Number.isFinite(raw.timeoutMsOverride)
        ? raw.timeoutMsOverride
        : null,
    systemPromptOverride:
      typeof raw.systemPromptOverride === "string"
        ? raw.systemPromptOverride
        : null,
  }),
  defaultData: (input) => ({
    label: input.label?.trim() || `Agent ${input.nextIndex}`,
    agentId: input.agentId ?? null,
    harness: "mogplex",
    role: input.role ?? "review",
    autofix: false,
    autofixSandbox: false,
    autoMerge: false,
    autoRevert: false,
    requireApproval: false,
    modelOverride: null,
    fallbackModelOverride: null,
    maxStepsOverride: null,
    timeoutMsOverride: null,
    systemPromptOverride: null,
  }),
};
