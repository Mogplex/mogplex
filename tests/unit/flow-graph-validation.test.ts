import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultFlowGraph,
  validateFlowGraph,
} from "../../lib/flows/graph";
import type { FlowGraph } from "../../lib/types";

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
