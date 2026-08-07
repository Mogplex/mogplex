import assert from "node:assert/strict";
import test from "node:test";
import {
  coerceGraph,
  evaluateConditionNode,
  validateFlowGraph,
} from "../../lib/flows/graph";
import type { FlowGraph } from "../../lib/types";

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
