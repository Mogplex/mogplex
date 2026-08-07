import assert from "node:assert/strict";
import test from "node:test";
import { createFlowAssistantTools } from "../../lib/flows/assistant-tools";
import {
  emptyGraph,
  allowedAgents,
  invokeTool,
} from "./helpers/flow-assistant-tools-fixtures";

test("connect with missing source returns error", async () => {
  const { tools, getResult } = createFlowAssistantTools({
    initialGraph: emptyGraph,
    allowedAgents,
  });

  await invokeTool(tools.setEnd, { label: "Done" });

  const result = await invokeTool<{ error?: string; id?: string }>(
    tools.connect,
    { source: "nonexistent", target: "end" }
  );

  assert.ok(result.error);
  assert.ok(result.error.includes("nonexistent"));
  assert.equal(getResult().graph.edges.length, 0);
});

test("connect with missing target returns error", async () => {
  const { tools, getResult } = createFlowAssistantTools({
    initialGraph: emptyGraph,
    allowedAgents,
  });

  await invokeTool(tools.setStart, { label: "Start", event: "pr_opened" });

  const result = await invokeTool<{ error?: string; id?: string }>(
    tools.connect,
    { source: "start", target: "nonexistent" }
  );

  assert.ok(result.error);
  assert.ok(result.error.includes("nonexistent"));
  assert.equal(getResult().graph.edges.length, 0);
});

test("connect with self-loop returns error", async () => {
  const { tools, getResult } = createFlowAssistantTools({
    initialGraph: emptyGraph,
    allowedAgents,
  });

  await invokeTool(tools.setStart, { label: "Start", event: "pr_opened" });

  const result = await invokeTool<{ error?: string; id?: string }>(
    tools.connect,
    { source: "start", target: "start" }
  );

  assert.ok(result.error);
  assert.ok(result.error.includes("itself"));
  assert.equal(getResult().graph.edges.length, 0);
});

test("connect with valid args returns id and appends edge", async () => {
  const { tools, getResult } = createFlowAssistantTools({
    initialGraph: emptyGraph,
    allowedAgents,
  });

  await invokeTool(tools.setStart, { label: "Start", event: "pr_opened" });
  await invokeTool(tools.setEnd, { label: "Done" });

  const result = await invokeTool<{ id: string }>(tools.connect, {
    source: "start",
    target: "end",
  });

  assert.ok(result.id);
  assert.ok(result.id.startsWith("edge-"));

  const graph = getResult().graph;
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0].source, "start");
  assert.equal(graph.edges[0].target, "end");
});

test("connect rejects duplicate edges with identical handles", async () => {
  const { tools, getResult } = createFlowAssistantTools({
    initialGraph: emptyGraph,
    allowedAgents,
  });

  await invokeTool(tools.setStart, { label: "Start", event: "pr_opened" });
  await invokeTool(tools.setEnd, { label: "Done" });

  await invokeTool(tools.connect, { source: "start", target: "end" });
  const second = await invokeTool<{ error?: string; id?: string }>(
    tools.connect,
    { source: "start", target: "end" }
  );

  assert.ok(second.error);
  assert.ok(second.error.includes("already exists"));
  assert.equal(second.id, undefined);
  assert.equal(getResult().graph.edges.length, 1);
});

test("connect allows same source/target when handles differ", async () => {
  const { tools, getResult } = createFlowAssistantTools({
    initialGraph: emptyGraph,
    allowedAgents,
  });

  await invokeTool(tools.setStart, { label: "Start", event: "pr_opened" });
  const cond = await invokeTool<{ id: string }>(tools.addConditionNode, {
    label: "Branch",
    field: "payload.kind",
    operator: "equals",
    value: "bug",
  });
  const agent = await invokeTool<{ id: string }>(tools.addAgentNode, {
    label: "Triage",
    agentId: "agent-1",
  });

  await invokeTool(tools.connect, {
    source: cond.id,
    target: agent.id,
    sourceHandle: "true",
  });
  const second = await invokeTool<{ id?: string; error?: string }>(
    tools.connect,
    { source: cond.id, target: agent.id, sourceHandle: "false" }
  );

  assert.ok(second.id);
  assert.equal(second.error, undefined);
  assert.equal(getResult().graph.edges.length, 2);
});
