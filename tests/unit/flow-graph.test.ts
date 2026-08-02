import assert from "node:assert/strict";
import test from "node:test";
import {
  buildExecutionLevels,
  coerceGraph,
  createDefaultFlowGraph,
  evaluateConditionNode,
  getDefaultFlowAgentRole,
  getStartConfig,
  validateFlowGraph,
} from "../../lib/flows/graph";
import { joinOperator } from "../../lib/flows/operators/join";
import { actionOperator } from "../../lib/flows/operators/action";
import { FLOW_OPERATOR_REGISTRY } from "../../lib/flows/operators/registry";
import {
  resolveTemplate,
  setVariableOperator,
} from "../../lib/flows/operators/state";
import {
  applyFlowTransform,
  transformOperator,
} from "../../lib/flows/operators/transform";
import type {
  FlowOperatorEmittedToken,
  FlowOperatorExecuteContext,
} from "../../lib/flows/operators/types";
import type { FlowGraph, FlowNode, FlowNodeType } from "../../lib/types";

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
  // The node is the only source of truth for the model — there is no agent-level
  // fallback any more — so publishing one without a model would hand the runtime
  // a step it cannot execute.
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
  // claude-code/codex shell out to their own CLI, which selects its own model;
  // requiring one here would make every harness node unpublishable.
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
  // A graph that is born unpublishable would make "create automation" fail on
  // first publish, so the default has to be filled in at construction.
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

test("validateFlowGraph rejects disconnected nodes", () => {
  const graph = createDefaultFlowGraph({
    event: "mention",
    agentId: "agent-1",
    agentName: "Responder",
  });

  graph.nodes.push({
    id: "agent-z",
    type: "agent",
    position: { x: 300, y: 320 },
    data: {
      label: "Detached",
      agentId: "agent-z",
      modelOverride: "openai/gpt-5.4",
    },
  });

  const validation = validateFlowGraph(graph);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("\n"), /disconnected/i);
});

test("validateFlowGraph rejects fix nodes without an upstream review node when not comment-triggered", () => {
  const graph = createDefaultFlowGraph({
    event: "pr_opened",
    agentId: "agent-1",
    agentName: "Fixer",
  });
  const fixer = graph.nodes.find((node) => node.type === "agent");
  assert.ok(fixer);
  fixer.data.role = "edit";

  const validation = validateFlowGraph(graph);
  assert.equal(validation.valid, false);
  assert.match(
    validation.errors.join("\n"),
    /Fix node "Fixer" must be placed after a Review node/
  );
});

test("validateFlowGraph accepts standalone fix nodes when triggered by a PR comment event", () => {
  for (const event of ["mention", "pr_comment"] as const) {
    const graph = createDefaultFlowGraph({
      event,
      agentId: "agent-1",
      agentName: "Fixer",
    });
    const fixer = graph.nodes.find((node) => node.type === "agent");
    assert.ok(fixer);
    fixer.data.role = "edit";

    const validation = validateFlowGraph(graph);
    assert.equal(
      validation.valid,
      true,
      `expected ${event} fix flow to validate; got: ${validation.errors.join(", ")}`
    );
  }
});

test("validateFlowGraph rejects standalone fix nodes triggered by issue_comment (no PR context)", () => {
  // issue_comment is only emitted for non-PR issue comments (PR conversation
  // comments come through as pr_comment), so a fix flow rooted there could
  // never resolve a PR to commit against. Reject up front instead of letting
  // it dead-end at runtime.
  const graph = createDefaultFlowGraph({
    event: "issue_comment",
    agentId: "agent-1",
    agentName: "Fixer",
  });
  const fixer = graph.nodes.find((node) => node.type === "agent");
  assert.ok(fixer);
  fixer.data.role = "edit";

  const validation = validateFlowGraph(graph);
  assert.equal(validation.valid, false);
  assert.match(
    validation.errors.join("\n"),
    /Fix node "Fixer" must be placed after a Review node/
  );
});

test("validateFlowGraph accepts fix nodes after a review node", () => {
  const graph: FlowGraph = {
    nodes: [
      {
        id: "start",
        type: "start",
        position: { x: 0, y: 0 },
        data: { label: "PR opened", event: "pr_opened" },
      },
      {
        id: "reviewer",
        type: "agent",
        position: { x: 200, y: 0 },
        data: {
          label: "Reviewer",
          agentId: "agent-review",
          role: "review",
          modelOverride: "openai/gpt-5.4",
        },
      },
      {
        id: "fixer",
        type: "agent",
        position: { x: 400, y: 0 },
        data: {
          label: "Fixer",
          agentId: "agent-fix",
          role: "edit",
          modelOverride: "openai/gpt-5.4",
        },
      },
      {
        id: "end",
        type: "end",
        position: { x: 600, y: 0 },
        data: { label: "Done" },
      },
    ],
    edges: [
      { id: "e1", source: "start", target: "reviewer" },
      { id: "e2", source: "reviewer", target: "fixer" },
      { id: "e3", source: "fixer", target: "end" },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };

  const validation = validateFlowGraph(graph);
  assert.equal(validation.valid, true);
});

test("validateFlowGraph accepts a single error edge from a canFail operator", () => {
  const graph: FlowGraph = {
    nodes: [
      {
        id: "start",
        type: "start",
        position: { x: 0, y: 0 },
        data: { label: "PR opened", event: "pr_opened" },
      },
      {
        id: "reviewer",
        type: "agent",
        position: { x: 200, y: 0 },
        data: {
          label: "Reviewer",
          agentId: "agent-review",
          role: "review",
          modelOverride: "openai/gpt-5.4",
        },
      },
      {
        id: "recovery",
        type: "agent",
        position: { x: 400, y: 100 },
        data: {
          label: "Recovery",
          agentId: "agent-recover",
          role: "triage",
          modelOverride: "openai/gpt-5.4",
        },
      },
      {
        id: "end",
        type: "end",
        position: { x: 600, y: 0 },
        data: { label: "Done" },
      },
    ],
    edges: [
      { id: "e1", source: "start", target: "reviewer" },
      { id: "e2", source: "reviewer", target: "end" },
      {
        id: "e3",
        source: "reviewer",
        target: "recovery",
        sourceHandle: "error",
      },
      { id: "e4", source: "recovery", target: "end" },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };

  const validation = validateFlowGraph(graph);
  assert.equal(
    validation.valid,
    true,
    `expected error-edge graph to validate; got: ${validation.errors.join(", ")}`
  );
});

test("validateFlowGraph rejects more than one error edge per node", () => {
  const graph: FlowGraph = {
    nodes: [
      {
        id: "start",
        type: "start",
        position: { x: 0, y: 0 },
        data: { label: "PR opened", event: "pr_opened" },
      },
      {
        id: "reviewer",
        type: "agent",
        position: { x: 200, y: 0 },
        data: {
          label: "Reviewer",
          agentId: "agent-review",
          role: "review",
          modelOverride: "openai/gpt-5.4",
        },
      },
      {
        id: "recovery-a",
        type: "agent",
        position: { x: 400, y: 80 },
        data: {
          label: "Recovery A",
          agentId: "agent-a",
          role: "triage",
          modelOverride: "openai/gpt-5.4",
        },
      },
      {
        id: "recovery-b",
        type: "agent",
        position: { x: 400, y: 200 },
        data: {
          label: "Recovery B",
          agentId: "agent-b",
          role: "triage",
          modelOverride: "openai/gpt-5.4",
        },
      },
      {
        id: "end",
        type: "end",
        position: { x: 600, y: 0 },
        data: { label: "Done" },
      },
    ],
    edges: [
      { id: "e1", source: "start", target: "reviewer" },
      { id: "e2", source: "reviewer", target: "end" },
      {
        id: "e3",
        source: "reviewer",
        target: "recovery-a",
        sourceHandle: "error",
      },
      {
        id: "e4",
        source: "reviewer",
        target: "recovery-b",
        sourceHandle: "error",
      },
      { id: "e5", source: "recovery-a", target: "end" },
      { id: "e6", source: "recovery-b", target: "end" },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };

  const validation = validateFlowGraph(graph);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("\n"), /at most one error edge/);
});

test("validateFlowGraph rejects error edges from operators that cannot fail", () => {
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
        position: { x: 200, y: 0 },
        data: { label: "Split" },
      },
      {
        id: "agent-a",
        type: "agent",
        position: { x: 400, y: 0 },
        data: {
          label: "Reviewer",
          agentId: "agent-a",
          role: "review",
          modelOverride: "openai/gpt-5.4",
        },
      },
      {
        id: "recovery",
        type: "agent",
        position: { x: 400, y: 200 },
        data: {
          label: "Recovery",
          agentId: "agent-r",
          role: "triage",
          modelOverride: "openai/gpt-5.4",
        },
      },
      {
        id: "end",
        type: "end",
        position: { x: 600, y: 0 },
        data: { label: "Done" },
      },
    ],
    edges: [
      { id: "e1", source: "start", target: "parallel" },
      { id: "e2", source: "parallel", target: "agent-a" },
      {
        id: "e3",
        source: "parallel",
        target: "recovery",
        sourceHandle: "error",
      },
      { id: "e4", source: "agent-a", target: "end" },
      { id: "e5", source: "recovery", target: "end" },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };

  const validation = validateFlowGraph(graph);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("\n"), /cannot have an error edge/);
});

test("validateFlowGraph accepts an error edge on a condition node alongside its then/else branches", () => {
  const graph: FlowGraph = {
    nodes: [
      {
        id: "start",
        type: "start",
        position: { x: 0, y: 0 },
        data: { label: "PR opened", event: "pr_opened" },
      },
      {
        id: "condition",
        type: "condition",
        position: { x: 200, y: 0 },
        data: {
          label: "Event gate",
          mode: "all",
          rules: [
            {
              field: "metadata.source_type",
              operator: "equals",
              value: "pr_opened",
            },
          ],
        },
      },
      {
        id: "agent-then",
        type: "agent",
        position: { x: 400, y: -80 },
        data: {
          label: "Then",
          agentId: "agent-then",
          role: "review",
          modelOverride: "openai/gpt-5.4",
        },
      },
      {
        id: "agent-else",
        type: "agent",
        position: { x: 400, y: 80 },
        data: {
          label: "Else",
          agentId: "agent-else",
          role: "review",
          modelOverride: "openai/gpt-5.4",
        },
      },
      {
        id: "recovery",
        type: "agent",
        position: { x: 400, y: 240 },
        data: {
          label: "Recovery",
          agentId: "agent-recover",
          role: "triage",
          modelOverride: "openai/gpt-5.4",
        },
      },
      {
        id: "end",
        type: "end",
        position: { x: 600, y: 0 },
        data: { label: "Done" },
      },
    ],
    edges: [
      { id: "e1", source: "start", target: "condition" },
      {
        id: "e2",
        source: "condition",
        target: "agent-then",
        sourceHandle: "true",
      },
      {
        id: "e3",
        source: "condition",
        target: "agent-else",
        sourceHandle: "false",
      },
      {
        id: "e4",
        source: "condition",
        target: "recovery",
        sourceHandle: "error",
      },
      { id: "e5", source: "agent-then", target: "end" },
      { id: "e6", source: "agent-else", target: "end" },
      { id: "e7", source: "recovery", target: "end" },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };

  const validation = validateFlowGraph(graph);
  assert.equal(
    validation.valid,
    true,
    `expected condition + error edge to validate; got: ${validation.errors.join(", ")}`
  );
});

test("validateFlowGraph accepts an error edge on a delay node alongside its single success edge", () => {
  const graph: FlowGraph = {
    nodes: [
      {
        id: "start",
        type: "start",
        position: { x: 0, y: 0 },
        data: { label: "PR opened", event: "pr_opened" },
      },
      {
        id: "delay",
        type: "delay",
        position: { x: 200, y: 0 },
        data: { label: "Wait", duration: 1, unit: "minutes" },
      },
      {
        id: "agent-after",
        type: "agent",
        position: { x: 400, y: 0 },
        data: {
          label: "Reviewer",
          agentId: "agent-r",
          role: "review",
          modelOverride: "openai/gpt-5.4",
        },
      },
      {
        id: "recovery",
        type: "agent",
        position: { x: 400, y: 200 },
        data: {
          label: "Recovery",
          agentId: "agent-recover",
          role: "triage",
          modelOverride: "openai/gpt-5.4",
        },
      },
      {
        id: "end",
        type: "end",
        position: { x: 600, y: 0 },
        data: { label: "Done" },
      },
    ],
    edges: [
      { id: "e1", source: "start", target: "delay" },
      { id: "e2", source: "delay", target: "agent-after" },
      {
        id: "e3",
        source: "delay",
        target: "recovery",
        sourceHandle: "error",
      },
      { id: "e4", source: "agent-after", target: "end" },
      { id: "e5", source: "recovery", target: "end" },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };

  const validation = validateFlowGraph(graph);
  assert.equal(
    validation.valid,
    true,
    `expected delay + error edge to validate; got: ${validation.errors.join(", ")}`
  );
});

test("validateFlowGraph accepts an error edge on an await_event node alongside its single success edge", () => {
  const graph: FlowGraph = {
    nodes: [
      {
        id: "start",
        type: "start",
        position: { x: 0, y: 0 },
        data: { label: "PR opened", event: "pr_opened" },
      },
      {
        id: "await",
        type: "await_event",
        position: { x: 200, y: 0 },
        data: {
          label: "Wait for ship",
          config: {
            kind: "github_label_added",
            labelName: "ship",
            prOnly: true,
          },
          timeout: { value: 1, unit: "hours" },
        },
      },
      {
        id: "agent-after",
        type: "agent",
        position: { x: 400, y: 0 },
        data: {
          label: "Reviewer",
          agentId: "agent-r",
          role: "review",
          modelOverride: "openai/gpt-5.4",
        },
      },
      {
        id: "recovery",
        type: "agent",
        position: { x: 400, y: 200 },
        data: {
          label: "Recovery",
          agentId: "agent-recover",
          role: "triage",
          modelOverride: "openai/gpt-5.4",
        },
      },
      {
        id: "end",
        type: "end",
        position: { x: 600, y: 0 },
        data: { label: "Done" },
      },
    ],
    edges: [
      { id: "e1", source: "start", target: "await" },
      { id: "e2", source: "await", target: "agent-after" },
      {
        id: "e3",
        source: "await",
        target: "recovery",
        sourceHandle: "error",
      },
      { id: "e4", source: "agent-after", target: "end" },
      { id: "e5", source: "recovery", target: "end" },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };

  const validation = validateFlowGraph(graph);
  assert.equal(
    validation.valid,
    true,
    `expected await_event + error edge to validate; got: ${validation.errors.join(", ")}`
  );
});

test("validateFlowGraph accepts condition, parallel, join, and delay nodes", () => {
  const graph: FlowGraph = {
    nodes: [
      {
        id: "start",
        type: "start",
        position: { x: 0, y: 0 },
        data: { label: "PR opened", event: "pr_opened" },
      },
      {
        id: "condition",
        type: "condition",
        position: { x: 200, y: 0 },
        data: {
          label: "Event gate",
          mode: "all",
          rules: [
            {
              field: "metadata.source_type",
              operator: "equals",
              value: "pr_opened",
            },
          ],
        },
      },
      {
        id: "parallel",
        type: "parallel",
        position: { x: 420, y: 0 },
        data: { label: "Split review" },
      },
      {
        id: "delay",
        type: "delay",
        position: { x: 640, y: -120 },
        data: { label: "Wait", duration: 5, unit: "minutes" },
      },
      {
        id: "agent-a",
        type: "agent",
        position: { x: 860, y: -120 },
        data: {
          label: "Reviewer A",
          agentId: "agent-a",
          modelOverride: "openai/gpt-5.4",
        },
      },
      {
        id: "agent-b",
        type: "agent",
        position: { x: 640, y: 120 },
        data: {
          label: "Reviewer B",
          agentId: "agent-b",
          modelOverride: "openai/gpt-5.4",
        },
      },
      {
        id: "join",
        type: "join",
        position: { x: 1080, y: 0 },
        data: { label: "Merge", policy: "wait_for_all" },
      },
      {
        id: "end",
        type: "end",
        position: { x: 1280, y: 0 },
        data: { label: "Done" },
      },
    ],
    edges: [
      { id: "e1", source: "start", target: "condition" },
      {
        id: "e2",
        source: "condition",
        sourceHandle: "true",
        target: "parallel",
      },
      {
        id: "e3",
        source: "condition",
        sourceHandle: "false",
        target: "agent-b",
      },
      { id: "e4", source: "parallel", target: "delay" },
      { id: "e5", source: "parallel", target: "agent-b" },
      { id: "e6", source: "delay", target: "agent-a" },
      { id: "e7", source: "agent-a", target: "join" },
      { id: "e8", source: "agent-b", target: "join" },
      { id: "e9", source: "join", target: "end" },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };

  const validation = validateFlowGraph(graph);
  assert.equal(validation.valid, true);
  assert.deepEqual(validation.errors, []);
});

test("coerceGraph converts legacy {field, operator, value} condition data into a one-rule group", () => {
  const graph = coerceGraph({
    nodes: [
      {
        id: "start",
        type: "start",
        position: { x: 0, y: 0 },
        data: { label: "Start", event: "pr_opened" },
      },
      {
        id: "cond",
        type: "condition",
        position: { x: 0, y: 0 },
        data: {
          label: "Legacy",
          field: "metadata.source_type",
          operator: "equals",
          value: "pr_opened",
        },
      },
    ],
    edges: [],
  });

  const cond = graph.nodes.find((node) => node.id === "cond");
  assert.ok(cond);
  assert.equal(cond.type, "condition");
  if (cond.type !== "condition") return;
  assert.equal(cond.data.mode, "all");
  assert.deepEqual(cond.data.rules, [
    { field: "metadata.source_type", operator: "equals", value: "pr_opened" },
  ]);
});

test("evaluateConditionNode honors mode 'all' and 'any' across rules", () => {
  const baseNode = {
    id: "cond",
    type: "condition" as const,
    position: { x: 0, y: 0 },
  };

  const allMatch = evaluateConditionNode({
    node: {
      ...baseNode,
      data: {
        label: "All match",
        mode: "all",
        rules: [
          { field: "a", operator: "equals", value: "1" },
          { field: "b", operator: "equals", value: "2" },
        ],
      },
    },
    state: { a: "1", b: "2" },
  });
  assert.equal(allMatch, true);

  const allMissOne = evaluateConditionNode({
    node: {
      ...baseNode,
      data: {
        label: "All requires both",
        mode: "all",
        rules: [
          { field: "a", operator: "equals", value: "1" },
          { field: "b", operator: "equals", value: "2" },
        ],
      },
    },
    state: { a: "1", b: "wrong" },
  });
  assert.equal(allMissOne, false);

  const anyHits = evaluateConditionNode({
    node: {
      ...baseNode,
      data: {
        label: "Any allows partial",
        mode: "any",
        rules: [
          { field: "a", operator: "equals", value: "1" },
          { field: "b", operator: "equals", value: "2" },
        ],
      },
    },
    state: { a: "wrong", b: "2" },
  });
  assert.equal(anyHits, true);
});

test("evaluateConditionNode supports in / not_in / is_empty / is_not_empty", () => {
  const baseNode = {
    id: "cond",
    type: "condition" as const,
    position: { x: 0, y: 0 },
  };

  const inMatch = evaluateConditionNode({
    node: {
      ...baseNode,
      data: {
        label: "in",
        mode: "all",
        rules: [
          {
            field: "metadata.source_type",
            operator: "in",
            value: "pr_opened, push",
          },
        ],
      },
    },
    state: { metadata: { source_type: "push" } },
  });
  assert.equal(inMatch, true);

  const notInMiss = evaluateConditionNode({
    node: {
      ...baseNode,
      data: {
        label: "not_in",
        mode: "all",
        rules: [
          {
            field: "metadata.source_type",
            operator: "not_in",
            value: "pr_opened, push",
          },
        ],
      },
    },
    state: { metadata: { source_type: "push" } },
  });
  assert.equal(notInMiss, false);

  const isEmptyTrue = evaluateConditionNode({
    node: {
      ...baseNode,
      data: {
        label: "is_empty",
        mode: "all",
        rules: [{ field: "metadata.labels", operator: "is_empty", value: "" }],
      },
    },
    state: { metadata: { labels: [] } },
  });
  assert.equal(isEmptyTrue, true);

  const isNotEmptyTrue = evaluateConditionNode({
    node: {
      ...baseNode,
      data: {
        label: "is_not_empty",
        mode: "all",
        rules: [
          { field: "metadata.labels", operator: "is_not_empty", value: "" },
        ],
      },
    },
    state: { metadata: { labels: ["bug"] } },
  });
  assert.equal(isNotEmptyTrue, true);
});

test("validateFlowGraph rejects If nodes with no rules", () => {
  const graph: FlowGraph = {
    nodes: [
      {
        id: "start",
        type: "start",
        position: { x: 0, y: 0 },
        data: { label: "Start", event: "pr_opened" },
      },
      {
        id: "cond",
        type: "condition",
        position: { x: 0, y: 0 },
        data: { label: "Empty", mode: "all", rules: [] },
      },
      {
        id: "agent-true",
        type: "agent",
        position: { x: 0, y: 0 },
        data: {
          label: "T",
          agentId: "agent-true",
          modelOverride: "openai/gpt-5.4",
        },
      },
      {
        id: "agent-false",
        type: "agent",
        position: { x: 0, y: 0 },
        data: {
          label: "F",
          agentId: "agent-false",
          modelOverride: "openai/gpt-5.4",
        },
      },
      {
        id: "end",
        type: "end",
        position: { x: 0, y: 0 },
        data: { label: "Done" },
      },
    ],
    edges: [
      { id: "e1", source: "start", target: "cond" },
      { id: "e2", source: "cond", sourceHandle: "true", target: "agent-true" },
      {
        id: "e3",
        source: "cond",
        sourceHandle: "false",
        target: "agent-false",
      },
      { id: "e4", source: "agent-true", target: "end" },
      { id: "e5", source: "agent-false", target: "end" },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };

  const validation = validateFlowGraph(graph);
  assert.equal(validation.valid, false);
  assert.ok(
    validation.errors.some((error) => error.includes("at least one rule"))
  );
});

function buildJoinPolicyGraph(joinData: Record<string, unknown>): FlowGraph {
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

test("validateFlowGraph accepts wait_for_any join policy", () => {
  const graph = buildJoinPolicyGraph({
    label: "Merge",
    policy: "wait_for_any",
  });
  const validation = validateFlowGraph(graph);
  assert.equal(validation.valid, true, validation.errors.join("\n"));
});

test("validateFlowGraph accepts quorum policy with valid threshold", () => {
  const graph = buildJoinPolicyGraph({
    label: "Merge",
    policy: "quorum",
    quorum: 2,
  });
  const validation = validateFlowGraph(graph);
  assert.equal(validation.valid, true, validation.errors.join("\n"));
});

test("validateFlowGraph rejects quorum policy without a quorum threshold", () => {
  const graph = buildJoinPolicyGraph({ label: "Merge", policy: "quorum" });
  const validation = validateFlowGraph(graph);
  assert.equal(validation.valid, false);
  assert.ok(
    validation.errors.some((error) => error.includes("quorum policy")),
    `expected quorum threshold error; got: ${validation.errors.join(", ")}`
  );
});

test("validateFlowGraph rejects quorum smaller than 2", () => {
  const graph = buildJoinPolicyGraph({
    label: "Merge",
    policy: "quorum",
    quorum: 1,
  });
  const validation = validateFlowGraph(graph);
  assert.equal(validation.valid, false);
  assert.ok(
    validation.errors.some((error) => error.includes("at least 2")),
    `expected 'at least 2' error; got: ${validation.errors.join(", ")}`
  );
});

test("validateFlowGraph rejects quorum greater than inbound edge count", () => {
  const graph = buildJoinPolicyGraph({
    label: "Merge",
    policy: "quorum",
    quorum: 5,
  });
  const validation = validateFlowGraph(graph);
  assert.equal(validation.valid, false);
  assert.ok(
    validation.errors.some((error) => error.includes("cannot exceed")),
    `expected 'cannot exceed' error; got: ${validation.errors.join(", ")}`
  );
});

test("coerceGraph defaults a missing join policy to wait_for_all and clears quorum", () => {
  const graph = coerceGraph({
    nodes: [
      {
        id: "start",
        type: "start",
        position: { x: 0, y: 0 },
        data: { label: "PR", event: "pr_opened" },
      },
      {
        id: "join",
        type: "join",
        position: { x: 0, y: 0 },
        data: { label: "Merge", quorum: 99 },
      },
      {
        id: "end",
        type: "end",
        position: { x: 0, y: 0 },
        data: { label: "Done" },
      },
    ],
    edges: [],
  });
  const join = graph.nodes.find((node) => node.type === "join");
  assert.ok(join);
  assert.equal(join.data.policy, "wait_for_all");
  assert.equal(join.data.quorum, null);
});

test("coerceGraph preserves quorum policy and threshold", () => {
  const graph = coerceGraph({
    nodes: [
      {
        id: "join",
        type: "join",
        position: { x: 0, y: 0 },
        data: { label: "Merge", policy: "quorum", quorum: 3 },
      },
    ],
    edges: [],
  });
  const join = graph.nodes.find((node) => node.type === "join");
  assert.ok(join);
  assert.equal(join.data.policy, "quorum");
  assert.equal(join.data.quorum, 3);
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

test("action operator keeps command source static and persists structured output", async () => {
  const actionNode: Extract<FlowNode, { type: "action" }> = {
    id: "action-1",
    type: "action",
    position: { x: 200, y: 0 },
    data: {
      label: "Test package",
      operation: "sandbox.run_command",
      command: "pnpm --filter web test",
      workingDirectory: null,
    },
  };
  const graph: FlowGraph = {
    nodes: [
      {
        id: "start",
        type: "start",
        position: { x: 0, y: 0 },
        data: { label: "Start", event: "push" },
      },
      actionNode,
      {
        id: "end",
        type: "end",
        position: { x: 400, y: 0 },
        data: { label: "Done" },
      },
    ],
    edges: [
      { id: "start-action", source: "start", target: actionNode.id },
      { id: "action-end", source: actionNode.id, target: "end" },
    ],
  };
  const completed: CompletedNodeRun[] = [];
  let receivedCommand = "";
  const outputs = new Map<string, { label: string; text: string }>();
  const result = await actionOperator.execute!({
    node: actionNode,
    label: actionNode.data.label,
    graph,
    inboundTokens: [
      {
        fromNodeId: "start",
        label: "Start",
        text: "",
        skipped: false,
      },
    ],
    activeInboundTokens: [
      {
        fromNodeId: "start",
        label: "Start",
        text: "",
        skipped: false,
      },
    ],
    shouldSkip: false,
    outputs,
    flowState: new Map(),
    resolutionState: {
      metadata: { package: "web; touch /tmp/should-not-run" },
    },
    predecessorOutputs: () => [],
    emit: (label, text, options) => [
      {
        targetId: "end",
        token: {
          fromNodeId: actionNode.id,
          label,
          text,
          skipped: options?.skipped ?? false,
          payload: options?.payload,
        },
      },
    ],
    completeNodeRun: async (completion) => {
      completed.push(completion);
      return 1;
    },
    completeSkipped: async () => ({ ok: true, emitted: [] }),
    jobRunId: "job-1",
    flowId: "flow-1",
    flowVersionId: null,
    userId: "user-1",
    installationId: 1,
    repoId: "repo-1",
    waitProvider: {
      sleep: async () => undefined,
      createToken: async () => ({ id: "token" }),
      waitForToken: async () => ({
        ok: false as const,
        reason: "timeout" as const,
        message: "unused",
      }),
    },
    waitStore: {
      createWait: async () => ({ id: "wait" }),
      finalizeWait: async () => undefined,
    },
    actionRunner: async ({ action }) => {
      assert.equal(action.operation, "sandbox.run_command");
      receivedCommand = action.command;
      return {
        summary: "Tests passed",
        output: { exit_code: 0, stdout: "ok" },
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(receivedCommand, "pnpm --filter web test");
  assert.deepEqual(completed[0], {
    status: "success",
    output: {
      operation: "sandbox.run_command",
      exit_code: 0,
      stdout: "ok",
    },
  });
  assert.deepEqual(outputs.get(actionNode.id), {
    label: "Test package",
    text: "Tests passed",
  });
  assert.equal(result.ok && result.emitted[0].token.payload?.exit_code, 0);
});

test("action validation rejects templates in shell command source", () => {
  const startNode: Extract<FlowNode, { type: "start" }> = {
    id: "start",
    type: "start",
    position: { x: 0, y: 0 },
    data: { label: "Start", event: "push" },
  };
  const node: Extract<FlowNode, { type: "action" }> = {
    id: "action-1",
    type: "action",
    position: { x: 200, y: 0 },
    data: {
      label: "Inspect branch",
      operation: "sandbox.run_command",
      command: "git diff {{ metadata.head_ref }}",
      workingDirectory: null,
    },
  };
  const errors = actionOperator.validate!({
    node,
    graph: {
      nodes: [startNode, node],
      edges: [
        { id: "in", source: "start", target: node.id },
        { id: "out", source: node.id, target: "end" },
      ],
    },
    inbound: [{ id: "in", source: "start", target: node.id }],
    outbound: [{ id: "out", source: node.id, target: "end" }],
    startNode,
    options: { requireRunnableConfig: true },
  });

  assert.deepEqual(errors, [
    'Action "Inspect branch" cannot use templates in shell commands.',
  ]);
});

test("coerceGraph preserves safe merge action configuration", () => {
  const graph = coerceGraph({
    nodes: [
      {
        id: "merge",
        type: "action",
        position: { x: 0, y: 0 },
        data: {
          label: "Merge when safe",
          operation: "github.merge_pull_request",
          pullRequestNumber: "{{ metadata.pr_number }}",
          commitTitle: "chore: merge {{ repo.full_name }}",
        },
      },
    ],
    edges: [],
  });

  assert.deepEqual(graph.nodes[0]?.data, {
    label: "Merge when safe",
    operation: "github.merge_pull_request",
    pullRequestNumber: "{{ metadata.pr_number }}",
    commitTitle: "chore: merge {{ repo.full_name }}",
  });
});

test("validateFlowGraph rejects multiple safe-merge request sources", () => {
  const graph = createDefaultFlowGraph({
    event: "pr_opened",
    agentId: "agent-1",
    agentName: "Reviewer",
  });
  const agentNode = graph.nodes.find((node) => node.type === "agent");
  const endNode = graph.nodes.find((node) => node.type === "end");
  assert.ok(agentNode);
  assert.ok(endNode);
  agentNode.data.autoMerge = true;
  graph.nodes.push({
    id: "merge",
    type: "action",
    position: { x: 480, y: 0 },
    data: {
      label: "Merge when safe",
      operation: "github.merge_pull_request",
      pullRequestNumber: null,
      commitTitle: null,
    },
  });
  graph.edges = [
    ...graph.edges.filter((edge) => edge.target !== endNode.id),
    { id: "agent-merge", source: agentNode.id, target: "merge" },
    { id: "merge-end", source: "merge", target: endNode.id },
  ];

  const validation = validateFlowGraph(graph);
  assert.equal(validation.valid, false);
  assert.ok(
    validation.errors.includes(
      "A flow can request at most one pull request merge."
    )
  );
});

test("action validation requires operation-specific fields and a success path", () => {
  const graph = coerceGraph({
    nodes: [
      {
        id: "start",
        type: "start",
        position: { x: 0, y: 0 },
        data: { label: "Start", event: "push" },
      },
      {
        id: "slack",
        type: "action",
        position: { x: 200, y: 0 },
        data: {
          label: "Notify",
          operation: "slack.send_message",
          teamId: "",
          channelId: "",
          message: "",
        },
      },
      {
        id: "agent",
        type: "agent",
        position: { x: 400, y: 0 },
        data: {
          label: "Reviewer",
          agentId: "agent-1",
          role: "review",
          modelOverride: "openai/gpt-5.4",
        },
      },
      {
        id: "end",
        type: "end",
        position: { x: 600, y: 0 },
        data: { label: "Done" },
      },
    ],
    edges: [
      { id: "start-slack", source: "start", target: "slack" },
      { id: "slack-agent", source: "slack", target: "agent" },
      { id: "agent-end", source: "agent", target: "end" },
    ],
  });
  const validation = validateFlowGraph(graph);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.includes("workspace")));
  assert.ok(validation.errors.some((error) => error.includes("channel")));
  assert.ok(validation.errors.some((error) => error.includes("message")));
});

test("Slack trigger-thread actions require a Slack mention trigger", () => {
  const graph = coerceGraph({
    nodes: [
      {
        id: "start",
        type: "start",
        position: { x: 0, y: 0 },
        data: { label: "Start", event: "schedule" },
      },
      {
        id: "slack",
        type: "action",
        position: { x: 200, y: 0 },
        data: {
          label: "Reply",
          operation: "slack.send_message",
          destination: "trigger_thread",
          message: "Done",
        },
      },
      {
        id: "agent",
        type: "agent",
        position: { x: 400, y: 0 },
        data: {
          label: "Reviewer",
          agentId: "agent-1",
          role: "review",
          modelOverride: "openai/gpt-5.4",
        },
      },
      {
        id: "end",
        type: "end",
        position: { x: 600, y: 0 },
        data: { label: "Done" },
      },
    ],
    edges: [
      { id: "start-slack", source: "start", target: "slack" },
      { id: "slack-agent", source: "slack", target: "agent" },
      { id: "agent-end", source: "agent", target: "end" },
    ],
  });

  const validation = validateFlowGraph(graph);

  assert.equal(validation.valid, false);
  assert.ok(
    validation.errors.some((error) =>
      error.includes("from a Slack mention trigger")
    )
  );
});

test("action operator validates GitHub effects and Slack trigger-thread replies", () => {
  const graph = coerceGraph({
    nodes: [
      {
        id: "start",
        type: "start",
        position: { x: 0, y: 0 },
        data: { label: "Start", event: "slack_mention" },
      },
      {
        id: "slack",
        type: "action",
        position: { x: 160, y: 0 },
        data: {
          label: "Reply",
          operation: "slack.send_message",
          destination: "trigger_thread",
          message: "Done",
        },
      },
      {
        id: "labels",
        type: "action",
        position: { x: 320, y: 0 },
        data: {
          label: "Labels",
          operation: "github.update_labels",
          addLabels: [],
          removeLabels: [],
        },
      },
      {
        id: "status",
        type: "action",
        position: { x: 480, y: 0 },
        data: {
          label: "Status",
          operation: "github.set_status",
          state: "not-real",
          context: "",
          targetUrl: "ftp://example.com/result",
        },
      },
      {
        id: "review",
        type: "action",
        position: { x: 640, y: 0 },
        data: {
          label: "Review",
          operation: "github.submit_review",
          event: "APPROVE",
          body: "",
        },
      },
      {
        id: "agent",
        type: "agent",
        position: { x: 800, y: 0 },
        data: {
          label: "Reviewer",
          agentId: "agent-1",
          role: "review",
          modelOverride: "openai/gpt-5.4",
        },
      },
      {
        id: "end",
        type: "end",
        position: { x: 960, y: 0 },
        data: { label: "Done" },
      },
    ],
    edges: [
      { id: "e1", source: "start", target: "slack" },
      { id: "e2", source: "slack", target: "labels" },
      { id: "e3", source: "labels", target: "status" },
      { id: "e4", source: "status", target: "review" },
      { id: "e5", source: "review", target: "agent" },
      { id: "e6", source: "agent", target: "end" },
    ],
  });
  const validation = validateFlowGraph(graph);

  assert.equal(validation.valid, false);
  assert.ok(
    validation.errors.some((error) =>
      error.includes("add or remove at least one label")
    )
  );
  assert.ok(
    validation.errors.some((error) => error.includes("status context"))
  );
  assert.ok(
    validation.errors.some((error) => error.includes("http(s) status URL"))
  );
  assert.ok(validation.errors.some((error) => error.includes("review body")));
  assert.equal(
    validation.errors.some((error) => error.includes("Slack workspace")),
    false
  );

  const status = graph.nodes.find((node) => node.id === "status");
  assert.equal(
    status?.type === "action" &&
      status.data.operation === "github.set_status" &&
      status.data.state,
    "success"
  );
});

type JoinNode = Extract<FlowNode, { type: "join" }>;

function buildJoinTestGraph(
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

function makeToken(
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

type CompletedNodeRun = {
  status: "success" | "failed" | "skipped" | "cancelled";
  output?: Record<string, unknown> | null;
  error?: string | null;
};

function buildExecuteContext(
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

test("join.isReady: wait_for_all only fires once every inbound has arrived", () => {
  const { joinNode } = buildJoinTestGraph("wait_for_all", null, 3);
  assert.equal(
    joinOperator.isReady!({
      node: joinNode,
      incomingCount: 3,
      receivedTokens: [makeToken("branch-0", "Branch 0")],
    }),
    false
  );
  assert.equal(
    joinOperator.isReady!({
      node: joinNode,
      incomingCount: 3,
      receivedTokens: [
        makeToken("branch-0", "Branch 0"),
        makeToken("branch-1", "Branch 1"),
        makeToken("branch-2", "Branch 2"),
      ],
    }),
    true
  );
});

test("join.isReady: wait_for_any flips true on the first active token", () => {
  const { joinNode } = buildJoinTestGraph("wait_for_any", null, 3);
  // First arrival is skipped — not enough yet, but must wait for actives.
  assert.equal(
    joinOperator.isReady!({
      node: joinNode,
      incomingCount: 3,
      receivedTokens: [makeToken("branch-0", "Branch 0", true)],
    }),
    false
  );
  // First active arrival flips ready.
  assert.equal(
    joinOperator.isReady!({
      node: joinNode,
      incomingCount: 3,
      receivedTokens: [
        makeToken("branch-0", "Branch 0", true),
        makeToken("branch-1", "Branch 1"),
      ],
    }),
    true
  );
  // All-skipped fall-through still flips ready (so the join can emit skipped).
  assert.equal(
    joinOperator.isReady!({
      node: joinNode,
      incomingCount: 3,
      receivedTokens: [
        makeToken("branch-0", "Branch 0", true),
        makeToken("branch-1", "Branch 1", true),
        makeToken("branch-2", "Branch 2", true),
      ],
    }),
    true
  );
});

test("join.isReady: quorum fires at the Nth active token", () => {
  const { joinNode } = buildJoinTestGraph("quorum", 2, 3);
  // 1 active + 1 skipped is not enough.
  assert.equal(
    joinOperator.isReady!({
      node: joinNode,
      incomingCount: 3,
      receivedTokens: [
        makeToken("branch-0", "Branch 0"),
        makeToken("branch-1", "Branch 1", true),
      ],
    }),
    false
  );
  // 2 active actives meets quorum.
  assert.equal(
    joinOperator.isReady!({
      node: joinNode,
      incomingCount: 3,
      receivedTokens: [
        makeToken("branch-0", "Branch 0"),
        makeToken("branch-1", "Branch 1"),
      ],
    }),
    true
  );
});

test("join.isReady: quorum becomes ready when the threshold is unreachable", () => {
  const { joinNode } = buildJoinTestGraph("quorum", 2, 3);
  // 1 active + 2 skipped, no remaining → unreachable, fire to skip.
  assert.equal(
    joinOperator.isReady!({
      node: joinNode,
      incomingCount: 3,
      receivedTokens: [
        makeToken("branch-0", "Branch 0"),
        makeToken("branch-1", "Branch 1", true),
        makeToken("branch-2", "Branch 2", true),
      ],
    }),
    true
  );
});

test("join.execute: wait_for_all writes active/skipped/pending labels", async () => {
  const { graph, joinNode } = buildJoinTestGraph("wait_for_all", null, 2);
  const tokens = [
    makeToken("branch-0", "Branch 0"),
    makeToken("branch-1", "Branch 1"),
  ];
  const { ctx, completed, emitted } = buildExecuteContext(
    graph,
    joinNode,
    tokens
  );
  const result = await joinOperator.execute!(ctx);

  assert.equal(result.ok, true);
  assert.equal(completed.length, 1);
  assert.equal(completed[0].status, "success");
  assert.deepEqual(completed[0].output, {
    policy: "wait_for_all",
    active_from: ["Branch 0", "Branch 1"],
    skipped_from: [],
    pending_from: [],
    emitted_after: 2,
    reason: "policy_satisfied",
  });
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].targetId, "end");
  assert.equal(emitted[0].token.skipped, false);
});

test("join.execute: wait_for_all with all branches skipped emits skipped downstream", async () => {
  const { graph, joinNode } = buildJoinTestGraph("wait_for_all", null, 2);
  const tokens = [
    makeToken("branch-0", "Branch 0", true),
    makeToken("branch-1", "Branch 1", true),
  ];
  const { ctx, completed, emitted } = buildExecuteContext(
    graph,
    joinNode,
    tokens
  );
  await joinOperator.execute!(ctx);

  assert.equal(completed.length, 1);
  assert.equal(completed[0].status, "skipped");
  assert.equal(completed[0].output!.reason, "all_skipped");
  assert.deepEqual(completed[0].output!.skipped_from, ["Branch 0", "Branch 1"]);
  assert.equal(emitted[0].token.skipped, true);
});

test("join.execute: wait_for_any emits success on first active arrival and lists pending branches", async () => {
  const { graph, joinNode } = buildJoinTestGraph("wait_for_any", null, 3);
  // Only branch-0 has arrived (active). branch-1 and branch-2 are still pending.
  const tokens = [makeToken("branch-0", "Branch 0")];
  const { ctx, completed, emitted } = buildExecuteContext(
    graph,
    joinNode,
    tokens
  );
  await joinOperator.execute!(ctx);

  assert.equal(completed.length, 1);
  assert.equal(completed[0].status, "success");
  const output = completed[0].output!;
  assert.equal(output.policy, "wait_for_any");
  assert.equal(output.reason, "policy_satisfied");
  assert.deepEqual(output.active_from, ["Branch 0"]);
  assert.deepEqual(output.skipped_from, []);
  assert.deepEqual((output.pending_from as string[]).sort(), [
    "Branch 1",
    "Branch 2",
  ]);
  assert.equal(output.emitted_after, 1);
  assert.equal(emitted[0].token.skipped, false);
});

test("join.execute: wait_for_any with all branches skipped emits skipped", async () => {
  const { graph, joinNode } = buildJoinTestGraph("wait_for_any", null, 2);
  const tokens = [
    makeToken("branch-0", "Branch 0", true),
    makeToken("branch-1", "Branch 1", true),
  ];
  const { ctx, completed, emitted } = buildExecuteContext(
    graph,
    joinNode,
    tokens
  );
  await joinOperator.execute!(ctx);

  assert.equal(completed[0].status, "skipped");
  assert.equal(completed[0].output!.reason, "all_skipped");
  assert.equal(emitted[0].token.skipped, true);
});

test("join.execute: quorum reached emits success and reports active branches", async () => {
  const { graph, joinNode } = buildJoinTestGraph("quorum", 2, 3);
  const tokens = [
    makeToken("branch-0", "Branch 0"),
    makeToken("branch-1", "Branch 1"),
  ];
  const { ctx, completed, emitted } = buildExecuteContext(
    graph,
    joinNode,
    tokens
  );
  await joinOperator.execute!(ctx);

  assert.equal(completed[0].status, "success");
  const output = completed[0].output!;
  assert.equal(output.policy, "quorum");
  assert.equal(output.quorum, 2);
  assert.equal(output.reason, "policy_satisfied");
  assert.deepEqual(output.active_from, ["Branch 0", "Branch 1"]);
  assert.deepEqual(output.pending_from, ["Branch 2"]);
  assert.equal(emitted[0].token.skipped, false);
});

test("join.execute: quorum unreachable emits skipped with quorum_unreachable reason", async () => {
  const { graph, joinNode } = buildJoinTestGraph("quorum", 2, 3);
  // 1 active, 2 skipped, all inbound arrived → can't make quorum=2.
  const tokens = [
    makeToken("branch-0", "Branch 0"),
    makeToken("branch-1", "Branch 1", true),
    makeToken("branch-2", "Branch 2", true),
  ];
  const { ctx, completed, emitted } = buildExecuteContext(
    graph,
    joinNode,
    tokens
  );
  await joinOperator.execute!(ctx);

  assert.equal(completed[0].status, "skipped");
  const output = completed[0].output!;
  assert.equal(output.policy, "quorum");
  assert.equal(output.quorum, 2);
  assert.equal(output.reason, "quorum_unreachable");
  assert.deepEqual(output.active_from, ["Branch 0"]);
  assert.deepEqual((output.skipped_from as string[]).sort(), [
    "Branch 1",
    "Branch 2",
  ]);
  assert.equal(emitted[0].token.skipped, true);
});

// ---------------------------------------------------------------------------
// Slice 5: set_variable operator
// ---------------------------------------------------------------------------

type SetVariableNode = Extract<FlowNode, { type: "set_variable" }>;

function buildSetVariablePolicyGraph(data: Record<string, unknown>): FlowGraph {
  // validateFlowGraph requires every flow to contain at least one agent node,
  // so the test graph routes through a triage agent before reaching the
  // set_variable node under inspection.
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

test("resolveTemplate: whole-string single substitution preserves native type", () => {
  const state = {
    metadata: { pr_number: 42, labels: ["bug", "ready"] },
    state: { active: true },
  };
  assert.equal(resolveTemplate("{{ metadata.pr_number }}", state), 42);
  assert.deepEqual(resolveTemplate("{{ metadata.labels }}", state), [
    "bug",
    "ready",
  ]);
  assert.equal(resolveTemplate("{{ state.active }}", state), true);
});

test("resolveTemplate: mixed text interpolates as string", () => {
  const state = {
    metadata: { pr_number: 42, sender_login: "alice" },
  };
  assert.equal(
    resolveTemplate(
      "PR #{{ metadata.pr_number }} by {{ metadata.sender_login }}",
      state
    ),
    "PR #42 by alice"
  );
});

test("resolveTemplate: missing path becomes null in single mode and empty in interp mode", () => {
  const state = { metadata: {} };
  assert.equal(resolveTemplate("{{ metadata.missing }}", state), null);
  assert.equal(
    resolveTemplate("hello {{ metadata.missing }}!", state),
    "hello !"
  );
});

test("resolveTemplate: literal with no substitution passes through", () => {
  assert.equal(resolveTemplate("just a literal", {}), "just a literal");
});

test("validateFlowGraph rejects set_variable with no assignments", () => {
  const graph = buildSetVariablePolicyGraph({
    label: "Set",
    assignments: [],
  });
  const result = validateFlowGraph(graph);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((message) =>
      message.includes("must define at least one assignment")
    ),
    `expected missing-assignment error, got: ${result.errors.join(" | ")}`
  );
});

test("validateFlowGraph rejects set_variable with invalid key", () => {
  const graph = buildSetVariablePolicyGraph({
    label: "Set",
    assignments: [{ key: "1bad-key", template: "{{ metadata.pr_number }}" }],
  });
  const result = validateFlowGraph(graph);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((message) => message.includes("invalid key")));
});

test("validateFlowGraph rejects set_variable with duplicate keys", () => {
  const graph = buildSetVariablePolicyGraph({
    label: "Set",
    assignments: [
      { key: "foo", template: "a" },
      { key: "foo", template: "b" },
    ],
  });
  const result = validateFlowGraph(graph);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((message) =>
      message.includes('assigns "foo" more than once')
    )
  );
});

test("validateFlowGraph accepts set_variable with valid assignments", () => {
  const graph = buildSetVariablePolicyGraph({
    label: "Set",
    assignments: [
      { key: "pr_number", template: "{{ metadata.pr_number }}" },
      { key: "summary", template: "PR #{{ metadata.pr_number }}" },
    ],
  });
  const result = validateFlowGraph(graph);
  assert.equal(result.valid, true, result.errors.join(" | "));
});

test("coerceGraph drops malformed assignments and keeps valid ones", () => {
  const coerced = coerceGraph({
    nodes: [
      {
        id: "set",
        type: "set_variable",
        position: { x: 0, y: 0 },
        data: {
          label: "Set",
          assignments: [
            { key: "ok", template: "{{ metadata.foo }}" },
            { key: "", template: "ignored" },
            "not an object",
            { template: "missing key" },
          ],
        },
      },
    ],
    edges: [],
  });
  const node = coerced.nodes.find((n) => n.type === "set_variable");
  assert.ok(node?.type === "set_variable");
  assert.deepEqual(node.data.assignments, [
    { key: "ok", template: "{{ metadata.foo }}" },
  ]);
});

test("setVariable.execute writes flowState and persists assignments", async () => {
  const graph = buildSetVariablePolicyGraph({
    label: "Set",
    assignments: [
      { key: "pr_number", template: "{{ metadata.pr_number }}" },
      { key: "summary", template: "PR #{{ metadata.pr_number }}" },
    ],
  });
  const setNode = graph.nodes.find((n) => n.type === "set_variable")!;
  const completed: CompletedNodeRun[] = [];
  const emitted: Array<{ targetId: string; token: FlowOperatorEmittedToken }> =
    [];
  const flowState = new Map<string, unknown>();
  const ctx: FlowOperatorExecuteContext<SetVariableNode> = {
    node: setNode,
    label: setNode.data.label,
    graph,
    inboundTokens: [
      {
        fromNodeId: "start",
        label: "Start",
        text: "",
        skipped: false,
        payload: null,
      },
    ],
    activeInboundTokens: [
      {
        fromNodeId: "start",
        label: "Start",
        text: "",
        skipped: false,
        payload: null,
      },
    ],
    shouldSkip: false,
    outputs: new Map(),
    flowState,
    resolutionState: { metadata: { pr_number: 42 } },
    predecessorOutputs: () => [],
    emit: (label, text, options) => [
      {
        targetId: "end",
        token: {
          fromNodeId: setNode.id,
          label,
          text,
          skipped: options?.skipped ?? false,
          payload: options?.payload ?? null,
        },
      },
    ],
    completeNodeRun: async (completion) => {
      completed.push(completion);
      return 1;
    },
    completeSkipped: async (reason) => {
      completed.push({ status: "skipped", output: { reason } });
      return { ok: true, emitted: [] };
    },
    jobRunId: "job-1",
    flowId: "flow-1",
    flowVersionId: null,
    userId: "user-1",
    installationId: null,
    repoId: null,
    waitProvider: {
      sleep: async () => undefined,
      createToken: async () => ({ id: "tok" }),
      waitForToken: async () => ({
        ok: false as const,
        reason: "timeout" as const,
        message: "n/a",
      }),
    },
    waitStore: {
      createWait: async () => ({ id: "w" }),
      finalizeWait: async () => undefined,
    },
    actionRunner: async () => ({ summary: "", output: {} }),
  };

  const result = await setVariableOperator.execute!(ctx);
  assert.equal(result.ok, true);
  // Type preservation: number stays number; mixed text becomes string.
  assert.equal(flowState.get("pr_number"), 42);
  assert.equal(flowState.get("summary"), "PR #42");
  assert.equal(completed.length, 1);
  assert.equal(completed[0].status, "success");
  const output = completed[0].output as {
    assignments: Array<{ key: string; template: string; value: unknown }>;
  };
  assert.deepEqual(output.assignments, [
    {
      key: "pr_number",
      template: "{{ metadata.pr_number }}",
      value: 42,
    },
    {
      key: "summary",
      template: "PR #{{ metadata.pr_number }}",
      value: "PR #42",
    },
  ]);
  assert.equal(emitted.length === 0, true);
  assert.equal(result.ok && result.emitted[0].token.skipped, false);
});

test("setVariable.execute skips when every inbound branch is skipped", async () => {
  const graph = buildSetVariablePolicyGraph({
    label: "Set",
    assignments: [{ key: "ok", template: "x" }],
  });
  const setNode = graph.nodes.find((n) => n.type === "set_variable")!;
  const completed: CompletedNodeRun[] = [];
  const flowState = new Map<string, unknown>();
  const ctx: FlowOperatorExecuteContext<SetVariableNode> = {
    node: setNode,
    label: setNode.data.label,
    graph,
    inboundTokens: [
      {
        fromNodeId: "start",
        label: "Start",
        text: "",
        skipped: true,
        payload: null,
      },
    ],
    activeInboundTokens: [],
    shouldSkip: true,
    outputs: new Map(),
    flowState,
    resolutionState: { metadata: {} },
    predecessorOutputs: () => [],
    emit: () => [],
    completeNodeRun: async (completion) => {
      completed.push(completion);
      return 1;
    },
    completeSkipped: async (reason) => {
      completed.push({ status: "skipped", output: { reason } });
      return { ok: true, emitted: [] };
    },
    jobRunId: "job-1",
    flowId: "flow-1",
    flowVersionId: null,
    userId: "user-1",
    installationId: null,
    repoId: null,
    waitProvider: {
      sleep: async () => undefined,
      createToken: async () => ({ id: "tok" }),
      waitForToken: async () => ({
        ok: false as const,
        reason: "timeout" as const,
        message: "n/a",
      }),
    },
    waitStore: {
      createWait: async () => ({ id: "w" }),
      finalizeWait: async () => undefined,
    },
    actionRunner: async () => ({ summary: "", output: {} }),
  };

  await setVariableOperator.execute!(ctx);
  assert.equal(flowState.size, 0);
  assert.equal(completed[0].status, "skipped");
});

// ---------------------------------------------------------------------------
// Transform operator
// ---------------------------------------------------------------------------

type TransformNode = Extract<FlowNode, { type: "transform" }>;

function buildTransformPolicyGraph(data: TransformNode["data"]): FlowGraph {
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

test("applyFlowTransform supports every bounded transform operation", () => {
  assert.equal(
    applyFlowTransform(
      { key: "copy", source: "metadata.title", operation: "copy" },
      "Fix tests"
    ),
    "Fix tests"
  );
  assert.equal(
    applyFlowTransform(
      {
        key: "contains",
        source: "metadata.title",
        operation: "string_contains",
        argument: "tests",
      },
      "Fix tests"
    ),
    true
  );
  assert.deepEqual(
    applyFlowTransform(
      {
        key: "parts",
        source: "metadata.labels",
        operation: "string_split",
        argument: ",",
      },
      "bug,ready"
    ),
    ["bug", "ready"]
  );
  assert.equal(
    applyFlowTransform(
      {
        key: "joined",
        source: "metadata.labels",
        operation: "array_join",
        argument: " · ",
      },
      ["bug", "ready"]
    ),
    "bug · ready"
  );
  assert.equal(
    applyFlowTransform(
      {
        key: "count",
        source: "metadata.labels",
        operation: "array_length",
      },
      ["bug", "ready"]
    ),
    2
  );
  assert.equal(
    applyFlowTransform(
      {
        key: "ready",
        source: "metadata.labels",
        operation: "array_includes",
        argument: "ready",
      },
      ["bug", "ready"]
    ),
    true
  );
  assert.equal(
    applyFlowTransform(
      {
        key: "tests_changed",
        source: "metadata.changed_files",
        operation: "files_match_glob",
        argument: "**/*.test.ts",
      },
      ["app/page.tsx", "lib/root.test.ts", "tests/unit/nested.test.ts"]
    ),
    true
  );
  assert.equal(
    applyFlowTransform(
      {
        key: "exact_test",
        source: "metadata.changed_files",
        operation: "files_match_glob",
        argument: "**/test.ts",
      },
      ["contest.ts"]
    ),
    false
  );
  assert.equal(
    applyFlowTransform(
      {
        key: "exact_test",
        source: "metadata.changed_files",
        operation: "files_match_glob",
        argument: "**/test.ts",
      },
      ["test.ts"]
    ),
    true
  );
  assert.equal(
    applyFlowTransform(
      {
        key: "nested_b",
        source: "metadata.changed_files",
        operation: "files_match_glob",
        argument: "a/**/b",
      },
      ["a/xxb"]
    ),
    false
  );
  assert.equal(
    applyFlowTransform(
      {
        key: "nested_b",
        source: "metadata.changed_files",
        operation: "files_match_glob",
        argument: "a/**/b",
      },
      ["a/b", "a/x/b"]
    ),
    true
  );
  assert.equal(
    applyFlowTransform(
      {
        key: "embedded_globstar",
        source: "metadata.changed_files",
        operation: "files_match_glob",
        argument: "a**/b",
      },
      ["afoo/x/b"]
    ),
    false
  );
  assert.equal(
    applyFlowTransform(
      {
        key: "embedded_globstar",
        source: "metadata.changed_files",
        operation: "files_match_glob",
        argument: "a**/b",
      },
      ["afoo/b"]
    ),
    true
  );
  assert.equal(
    applyFlowTransform(
      {
        key: "enabled",
        source: "metadata.enabled",
        operation: "cast_boolean",
      },
      "yes"
    ),
    true
  );
  assert.equal(
    applyFlowTransform(
      {
        key: "retries",
        source: "metadata.retries",
        operation: "cast_number",
      },
      "3"
    ),
    3
  );
});

test("validateFlowGraph rejects malformed transform configuration", () => {
  const graph = buildTransformPolicyGraph({
    label: "Derive state",
    assignments: [
      {
        key: "1bad",
        source: "metadata.changed files",
        operation: "files_match_glob",
      },
    ],
  });
  const result = validateFlowGraph(graph);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("invalid key")));
  assert.ok(
    result.errors.some((error) => error.includes("invalid source path"))
  );
  assert.ok(
    result.errors.some((error) =>
      error.includes("requires an argument for files_match_glob")
    )
  );
});

test("coerceGraph preserves valid transform assignments and drops malformed entries", () => {
  const graph = coerceGraph({
    nodes: [
      {
        id: "transform",
        type: "transform",
        position: { x: 0, y: 0 },
        data: {
          label: "Derive state",
          assignments: [
            {
              key: "tests_changed",
              source: "metadata.changed_files",
              operation: "files_match_glob",
              argument: "**/*.test.ts",
            },
            { key: "", source: "metadata.title", operation: "copy" },
            "bad",
          ],
        },
      },
    ],
    edges: [],
  });
  const node = graph.nodes[0];
  assert.ok(node?.type === "transform");
  assert.deepEqual(node.data.assignments, [
    {
      key: "tests_changed",
      source: "metadata.changed_files",
      operation: "files_match_glob",
      argument: "**/*.test.ts",
    },
  ]);
});

test("coerceGraph preserves unsupported transform operations for validation", () => {
  const graph = coerceGraph({
    nodes: [
      {
        id: "start",
        type: "start",
        position: { x: 0, y: 0 },
        data: { label: "PR opened", event: "pr_opened" },
      },
      {
        id: "agent",
        type: "agent",
        position: { x: 150, y: 0 },
        data: {
          label: "Review",
          agentId: "agent-1",
          role: "review",
          modelOverride: "openai/gpt-5.4",
        },
      },
      {
        id: "transform",
        type: "transform",
        position: { x: 300, y: 0 },
        data: {
          label: "Derive state",
          assignments: [
            {
              key: "file_count",
              source: "metadata.changed_files",
              operation: "array_lenght",
            },
          ],
        },
      },
      {
        id: "end",
        type: "end",
        position: { x: 450, y: 0 },
        data: { label: "Done" },
      },
    ],
    edges: [
      { id: "e1", source: "start", target: "agent" },
      { id: "e2", source: "agent", target: "transform" },
      { id: "e3", source: "transform", target: "end" },
    ],
  });
  const node = graph.nodes.find((candidate) => candidate.id === "transform");
  assert.ok(node?.type === "transform");
  assert.equal(node.data.assignments[0]?.operation, "array_lenght");

  const result = validateFlowGraph(graph);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((error) =>
      error.includes('unsupported operation "array_lenght"')
    )
  );
});

function createTransformContext(input: {
  node: TransformNode;
  resolutionState: Record<string, unknown>;
}) {
  const completed: CompletedNodeRun[] = [];
  const flowState = new Map<string, unknown>();
  const context: FlowOperatorExecuteContext<TransformNode> = {
    node: input.node,
    label: input.node.data.label,
    graph: buildTransformPolicyGraph(input.node.data),
    inboundTokens: [
      {
        fromNodeId: "triage",
        label: "Triage",
        text: "done",
        skipped: false,
      },
    ],
    activeInboundTokens: [
      {
        fromNodeId: "triage",
        label: "Triage",
        text: "done",
        skipped: false,
      },
    ],
    shouldSkip: false,
    outputs: new Map(),
    flowState,
    resolutionState: input.resolutionState,
    predecessorOutputs: () => [],
    emit: (label, text, options) => [
      {
        targetId: "end",
        token: {
          fromNodeId: input.node.id,
          label,
          text,
          skipped: options?.skipped ?? false,
          payload: options?.payload ?? null,
        },
      },
    ],
    completeNodeRun: async (completion) => {
      completed.push(completion);
      return 1;
    },
    completeSkipped: async () => ({ ok: true, emitted: [] }),
    jobRunId: "job-1",
    flowId: "flow-1",
    flowVersionId: null,
    userId: "user-1",
    installationId: 1,
    repoId: "repo-1",
    waitProvider: {
      sleep: async () => undefined,
      createToken: async () => ({ id: "token" }),
      waitForToken: async () => ({
        ok: false as const,
        reason: "timeout" as const,
        message: "n/a",
      }),
    },
    waitStore: {
      createWait: async () => ({ id: "wait" }),
      finalizeWait: async () => undefined,
    },
    actionRunner: async () => ({ summary: "", output: {} }),
  };
  return { context, completed, flowState };
}

test("transform.execute writes typed state and persists structured output", async () => {
  const node: TransformNode = {
    id: "transform",
    type: "transform",
    position: { x: 0, y: 0 },
    data: {
      label: "Derive state",
      assignments: [
        {
          key: "tests_changed",
          source: "metadata.changed_files",
          operation: "files_match_glob",
          argument: "**/*.test.ts",
        },
        {
          key: "file_count",
          source: "metadata.changed_files",
          operation: "array_length",
        },
        {
          key: "retries",
          source: "metadata.retries",
          operation: "cast_number",
        },
      ],
    },
  };
  const { context, completed, flowState } = createTransformContext({
    node,
    resolutionState: {
      metadata: {
        changed_files: ["app/page.tsx", "lib/page.test.ts"],
        retries: "2",
      },
    },
  });

  const result = await transformOperator.execute!(context);
  assert.equal(result.ok, true);
  assert.equal(flowState.get("tests_changed"), true);
  assert.equal(flowState.get("file_count"), 2);
  assert.equal(flowState.get("retries"), 2);
  assert.equal(completed[0]?.status, "success");
  assert.deepEqual(
    (completed[0]?.output as { transformations: unknown[] }).transformations,
    [
      { ...node.data.assignments[0], value: true },
      { ...node.data.assignments[1], value: 2 },
      { ...node.data.assignments[2], value: 2 },
    ]
  );
  assert.deepEqual(result.ok ? result.emitted[0]?.token.payload : null, {
    state: {
      tests_changed: true,
      file_count: 2,
      retries: 2,
    },
  });
});

test("transform.execute fails atomically when a source cannot be resolved", async () => {
  const node: TransformNode = {
    id: "transform",
    type: "transform",
    position: { x: 0, y: 0 },
    data: {
      label: "Derive state",
      assignments: [
        { key: "title", source: "metadata.title", operation: "copy" },
        { key: "missing", source: "metadata.missing", operation: "copy" },
      ],
    },
  };
  const { context, completed, flowState } = createTransformContext({
    node,
    resolutionState: { metadata: { title: "PR title" } },
  });

  const result = await transformOperator.execute!(context);
  assert.equal(result.ok, false);
  assert.equal(flowState.size, 0);
  assert.equal(completed[0]?.status, "failed");
  assert.match(
    result.ok ? "" : result.message,
    /could not resolve "metadata\.missing"/
  );
});

function startNodeFromCoerce(filter: unknown, event = "pr_opened") {
  const graph = coerceGraph({
    nodes: [
      {
        id: "start",
        type: "start",
        position: { x: 0, y: 0 },
        data: { label: "Start", event, filter },
      },
    ],
    edges: [],
  });
  const start = graph.nodes.find((node) => node.type === "start");
  assert.ok(start);
  return start.data;
}

test("coerceGraph preserves a fully-specified start.filter through round-trip", () => {
  const data = startNodeFromCoerce({
    scope: "org",
    installationIds: [12345],
    repos: ["acme/web"],
  });
  assert.deepEqual(data.filter, {
    scope: "org",
    installationIds: [12345],
    repos: ["acme/web"],
  });
});

test("coerceGraph drops an empty start.filter object so flows_no_filter counts it", () => {
  // Phase 2 dual-read parity: an empty {} or all-garbage filter object must
  // collapse to undefined so the parity log surfaces it under flows_no_filter
  // rather than silently treating it as a populated filter.
  assert.equal(startNodeFromCoerce({}).filter, undefined);
  assert.equal(startNodeFromCoerce({ scope: "garbage" }).filter, undefined);
  assert.equal(
    startNodeFromCoerce({ installationIds: ["not-a-number"] }).filter,
    undefined
  );
});

test("coerceGraph keeps start.filter.authorFilter only for pr_opened", () => {
  // pr_opened routes with PR-author context, so the filter survives.
  assert.deepEqual(
    startNodeFromCoerce({ scope: "all", authorFilter: "dependabot_only" })
      .filter,
    { scope: "all", authorFilter: "dependabot_only" }
  );
  // Other events have no PR author; a stale dependabot_only left behind by an
  // event switch would fail closed on every delivery, so coercion drops it.
  // The explicit scope survives (it is harmless — "all" matches everything).
  assert.deepEqual(
    startNodeFromCoerce(
      { scope: "all", authorFilter: "dependabot_only" },
      "issue_opened"
    ).filter,
    { scope: "all" }
  );
  // With nothing but the stale author filter, the whole filter collapses.
  assert.equal(
    startNodeFromCoerce({ authorFilter: "dependabot_only" }, "issue_opened")
      .filter,
    undefined
  );
  // Non-author fields survive the strip.
  assert.deepEqual(
    startNodeFromCoerce(
      { scope: "org", repos: ["acme/web"], authorFilter: "exclude_dependabot" },
      "mention"
    ).filter,
    { scope: "org", repos: ["acme/web"] }
  );
});

test("coerceGraph normalizes start.filter scope and drops empty list fields", () => {
  // Default scope when omitted but other fields present.
  assert.deepEqual(startNodeFromCoerce({ installationIds: [1, 2] }).filter, {
    scope: "all",
    installationIds: [1, 2],
  });
  // Repos are trimmed and non-string entries dropped.
  assert.deepEqual(
    startNodeFromCoerce({
      scope: "all",
      repos: [" Acme/Web ", 42, "alice/dotfiles"],
    }).filter,
    { scope: "all", repos: ["Acme/Web", "alice/dotfiles"] }
  );
});

function startDataFromCoerce(data: Record<string, unknown>) {
  const graph = coerceGraph({
    nodes: [
      {
        id: "start",
        type: "start",
        position: { x: 0, y: 0 },
        data: { label: "Start", ...data },
      },
    ],
    edges: [],
  });
  const start = graph.nodes.find((node) => node.type === "start");
  assert.ok(start);
  return start.data;
}

test("coerceGraph keeps trimmed label fields only for the labeled event", () => {
  const labeled = startDataFromCoerce({
    event: "labeled",
    labelName: "  ready-for-review  ",
    labelPrOnly: true,
  });
  assert.equal(labeled.labelName, "ready-for-review");
  assert.equal(labeled.labelPrOnly, true);

  // Empty label name collapses to "any label" (field omitted entirely).
  const anyLabel = startDataFromCoerce({
    event: "labeled",
    labelName: "   ",
    labelPrOnly: false,
  });
  assert.equal(anyLabel.labelName, undefined);
  assert.equal(anyLabel.labelPrOnly, undefined);

  // Stale label fields left behind by an event switch are dropped so they
  // cannot silently narrow routing if the user switches back later.
  const stale = startDataFromCoerce({
    event: "pr_opened",
    labelName: "ready-for-review",
    labelPrOnly: true,
  });
  assert.equal(stale.labelName, undefined);
  assert.equal(stale.labelPrOnly, undefined);
});

test("getStartConfig exposes label fields for webhook routing", () => {
  const graph = coerceGraph({
    nodes: [
      {
        id: "start",
        type: "start",
        position: { x: 0, y: 0 },
        data: {
          label: "Label added",
          event: "labeled",
          labelName: "deploy",
          labelPrOnly: true,
        },
      },
    ],
    edges: [],
  });
  const start = getStartConfig(graph);
  assert.equal(start?.event, "labeled");
  assert.equal(start?.labelName, "deploy");
  assert.equal(start?.labelPrOnly, true);
});

test("coerceGraph keeps a trimmed tagPattern only for the tag_push event", () => {
  const tagged = startDataFromCoerce({
    event: "tag_push",
    tagPattern: "  v*  ",
  });
  assert.equal(tagged.tagPattern, "v*");

  const empty = startDataFromCoerce({ event: "tag_push", tagPattern: "   " });
  assert.equal(empty.tagPattern, undefined);

  const stale = startDataFromCoerce({ event: "push", tagPattern: "v*" });
  assert.equal(stale.tagPattern, undefined);
});

test("coerceGraph preserves only the selected external trigger configuration", () => {
  const schedule = startDataFromCoerce({
    event: "schedule",
    scheduleCron: " 0 9 * * 1-5 ",
    scheduleTimezone: " America/New_York ",
    slackTeamId: "stale",
  });
  assert.equal(schedule.scheduleCron, "0 9 * * 1-5");
  assert.equal(schedule.scheduleTimezone, "America/New_York");
  assert.equal(schedule.slackTeamId, undefined);

  const slack = startDataFromCoerce({
    event: "slack_mention",
    slackTeamId: " T123 ",
    slackChannelId: " C456 ",
    slackChannelName: " releases ",
    scheduleCron: "stale",
  });
  assert.equal(slack.slackTeamId, "T123");
  assert.equal(slack.slackChannelId, "C456");
  assert.equal(slack.slackChannelName, "releases");
  assert.equal(slack.scheduleCron, undefined);

  assert.equal(
    startDataFromCoerce({ event: "not-a-trigger" }).event,
    "mention"
  );
});

test("validateFlowGraph requires one repo and complete external trigger config", () => {
  const graph = createDefaultFlowGraph({
    event: "schedule",
    agentId: "agent-1",
    agentName: "Reviewer",
  });
  const start = graph.nodes.find((node) => node.type === "start");
  assert.ok(start);
  start.data = {
    ...start.data,
    event: "schedule",
    scheduleCron: "0 9 * * 1-5",
    scheduleTimezone: "America/New_York",
    filter: { scope: "all", repos: ["acme/web"] },
  };
  assert.deepEqual(validateFlowGraph(graph), { valid: true, errors: [] });

  start.data.filter = { scope: "all", repos: ["acme/web", "acme/api"] };
  assert.match(
    validateFlowGraph(graph).errors.join("\n"),
    /exactly one repository/i
  );

  start.data = {
    ...start.data,
    event: "slack_mention",
    filter: { scope: "all", repos: ["acme/web"] },
    slackTeamId: "",
    slackChannelId: "",
  };
  const slackErrors = validateFlowGraph(graph).errors.join("\n");
  assert.match(slackErrors, /select a workspace/i);
  assert.match(slackErrors, /select a channel/i);
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
