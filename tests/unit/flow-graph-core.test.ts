import assert from "node:assert/strict";
import test from "node:test";
import {
  buildExecutionLevels,
  coerceGraph,
  createDefaultFlowGraph,
  getDefaultFlowAgentRole,
  validateFlowGraph,
} from "../../lib/flows/graph";
import { FLOW_OPERATOR_REGISTRY } from "../../lib/flows/operators/registry";
import type { FlowGraph, FlowNodeType } from "../../lib/types";

test("createDefaultFlowGraph builds a publishable graph", () => {
  const graph = createDefaultFlowGraph({
    event: "pr_opened",
    agentId: "agent-1",
    agentName: "Reviewer",
  });

  const validation = validateFlowGraph(graph);
  assert.equal(validation.valid, true);
  assert.deepEqual(validation.errors, []);
  const agentNode = graph.nodes.find((node) => node.type === "agent");
  assert.equal(agentNode?.data.role, "review");
});

test("coerceGraph preserves sandbox autofix opt-in on agent nodes", () => {
  const graph = coerceGraph({
    nodes: [
      {
        id: "agent-1",
        type: "agent",
        position: { x: 0, y: 0 },
        data: {
          label: "Reviewer",
          agentId: "agent-1",
          role: "review",
          autofix: true,
          autofixSandbox: true,
          modelOverride: "openai/gpt-5.4",
        },
      },
    ],
    edges: [],
  });

  const agentNode = graph.nodes[0];
  assert.equal(agentNode?.type, "agent");
  assert.equal(agentNode?.data.autofix, true);
  assert.equal(agentNode?.data.autofixSandbox, true);
});

test("coerceGraph preserves supported harnesses and defaults legacy nodes to Mogplex", () => {
  const graph = coerceGraph({
    nodes: [
      {
        id: "claude",
        type: "agent",
        position: { x: 0, y: 0 },
        data: {
          label: "Claude reviewer",
          agentId: null,
          harness: "claude-code",
          modelOverride: "openai/gpt-5.4",
        },
      },
      {
        id: "legacy",
        type: "agent",
        position: { x: 200, y: 0 },
        data: {
          label: "Legacy reviewer",
          agentId: "agent-1",
          modelOverride: "openai/gpt-5.4",
        },
      },
    ],
    edges: [],
  });

  assert.equal(graph.nodes[0]?.type, "agent");
  assert.equal(graph.nodes[0]?.data.harness, "claude-code");
  assert.equal(graph.nodes[1]?.type, "agent");
  assert.equal(graph.nodes[1]?.data.harness, "mogplex");
});

test("validateFlowGraph allows CLI harness nodes without a Mogplex agent binding", () => {
  const graph = createDefaultFlowGraph({
    event: "pr_opened",
    agentId: null,
    agentName: "Claude reviewer",
  });
  const agentNode = graph.nodes.find((node) => node.type === "agent");
  assert.ok(agentNode);
  agentNode.data.harness = "claude-code";

  assert.deepEqual(validateFlowGraph(graph), {
    valid: true,
    errors: [],
  });
});

test("validateFlowGraph still requires a binding for Mogplex agent nodes", () => {
  const graph = createDefaultFlowGraph({
    event: "pr_opened",
    agentId: null,
    agentName: "Managed reviewer",
  });

  const validation = validateFlowGraph(graph);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("\n"), /must be assigned to an agent/i);
});

test("validateFlowGraph rejects a Mogplex agent node with no model selected", () => {
  const graph = createDefaultFlowGraph({
    event: "pr_opened",
    agentId: "agent-1",
    agentName: "Reviewer",
  });
  const agentNode = graph.nodes.find((node) => node.type === "agent");
  assert.ok(agentNode);
  agentNode.data.modelOverride = null;

  const validation = validateFlowGraph(graph);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("\n"), /must have a model selected/i);
});

test("validateFlowGraph treats a whitespace-only model as unset", () => {
  const graph = createDefaultFlowGraph({
    event: "pr_opened",
    agentId: "agent-1",
    agentName: "Reviewer",
  });
  const agentNode = graph.nodes.find((node) => node.type === "agent");
  assert.ok(agentNode);
  agentNode.data.modelOverride = "   ";

  const validation = validateFlowGraph(graph);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("\n"), /must have a model selected/i);
});

test("validateFlowGraph exempts CLI harness nodes from the model requirement", () => {
  const graph = createDefaultFlowGraph({
    event: "pr_opened",
    agentId: null,
    agentName: "Claude reviewer",
  });
  const agentNode = graph.nodes.find((node) => node.type === "agent");
  assert.ok(agentNode);
  agentNode.data.harness = "claude-code";
  agentNode.data.modelOverride = null;

  assert.deepEqual(validateFlowGraph(graph), { valid: true, errors: [] });
});

test("createDefaultFlowGraph gives every new agent node a model", () => {
  const graph = createDefaultFlowGraph({
    event: "pr_opened",
    agentId: "agent-1",
    agentName: "Reviewer",
  });
  const agentNode = graph.nodes.find((node) => node.type === "agent");
  assert.ok(agentNode?.data.modelOverride);
  assert.equal(validateFlowGraph(graph).valid, true);
});

test("createDefaultFlowGraph honours an explicitly requested model", () => {
  const graph = createDefaultFlowGraph({
    event: "pr_opened",
    agentId: "agent-1",
    agentName: "Reviewer",
    modelId: "anthropic/claude-opus-5",
  });
  const agentNode = graph.nodes.find((node) => node.type === "agent");
  assert.equal(agentNode?.data.modelOverride, "anthropic/claude-opus-5");
});

test("getDefaultFlowAgentRole follows the source event", () => {
  assert.equal(getDefaultFlowAgentRole("pr_opened"), "review");
  assert.equal(getDefaultFlowAgentRole("mention"), "triage");
  assert.equal(getDefaultFlowAgentRole("issue_comment"), "triage");
});

test("buildExecutionLevels groups parallel agents before join nodes", () => {
  const graph: FlowGraph = {
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
        position: { x: 120, y: 70 },
        data: { label: "Split review" },
      },
      {
        id: "agent-a",
        type: "agent",
        position: { x: 320, y: 0 },
        data: {
          label: "Reviewer A",
          agentId: "agent-a",
          modelOverride: "openai/gpt-5.4",
        },
      },
      {
        id: "agent-b",
        type: "agent",
        position: { x: 320, y: 140 },
        data: {
          label: "Reviewer B",
          agentId: "agent-b",
          modelOverride: "openai/gpt-5.4",
        },
      },
      {
        id: "agent-c",
        type: "agent",
        position: { x: 560, y: 70 },
        data: {
          label: "Synthesizer",
          agentId: "agent-c",
          modelOverride: "openai/gpt-5.4",
        },
      },
      {
        id: "end",
        type: "end",
        position: { x: 720, y: 70 },
        data: { label: "Done" },
      },
    ],
    edges: [
      { id: "e1", source: "start", target: "parallel" },
      { id: "e2", source: "parallel", target: "agent-a" },
      { id: "e3", source: "parallel", target: "agent-b" },
      { id: "e4", source: "agent-a", target: "agent-c" },
      { id: "e5", source: "agent-b", target: "agent-c" },
      { id: "e6", source: "agent-c", target: "end" },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };

  const levels = buildExecutionLevels(graph);
  assert.equal(levels.length, 2);
  assert.deepEqual(levels[0].map((node) => node.id).sort(), [
    "agent-a",
    "agent-b",
  ]);
  assert.deepEqual(
    levels[1].map((node) => node.id),
    ["agent-c"]
  );
});

test("FLOW_OPERATOR_REGISTRY covers every FlowNodeType", () => {
  const expected: FlowNodeType[] = [
    "start",
    "agent",
    "action",
    "condition",
    "parallel",
    "join",
    "delay",
    "await_event",
    "set_variable",
    "transform",
    "end",
  ];
  for (const type of expected) {
    const operator = FLOW_OPERATOR_REGISTRY[type];
    assert.ok(operator, `missing registry entry for "${type}"`);
    assert.equal(operator.type, type);
    assert.equal(typeof operator.coerceData, "function");
    assert.equal(typeof operator.defaultData, "function");
  }
  assert.deepEqual(
    Object.keys(FLOW_OPERATOR_REGISTRY).sort(),
    [...expected].sort()
  );
});

test("coerceGraph normalizes the agent autoRevert flag", () => {
  const graph = coerceGraph({
    nodes: [
      {
        id: "agent-1",
        type: "agent",
        position: { x: 0, y: 0 },
        data: {
          label: "Agent",
          agentId: "a",
          autoRevert: true,
          modelOverride: "openai/gpt-5.4",
        },
      },
      {
        id: "agent-2",
        type: "agent",
        position: { x: 0, y: 0 },
        data: {
          label: "Agent",
          agentId: "a",
          autoRevert: "yes",
          modelOverride: "openai/gpt-5.4",
        },
      },
    ],
    edges: [],
  });
  const [first, second] = graph.nodes;
  assert.equal(first?.type === "agent" && first.data.autoRevert, true);
  assert.equal(second?.type === "agent" && second.data.autoRevert, false);
});
