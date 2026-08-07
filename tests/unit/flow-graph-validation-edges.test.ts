import assert from "node:assert/strict";
import test from "node:test";
import { validateFlowGraph } from "../../lib/flows/graph";
import type { FlowGraph } from "../../lib/types";

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
