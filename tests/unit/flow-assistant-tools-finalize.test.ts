import assert from "node:assert/strict";
import test from "node:test";
import { createFlowAssistantTools } from "../../lib/flows/assistant-tools";
import type { FlowGraph } from "../../lib/types";
import {
  emptyGraph,
  allowedAgents,
  invokeTool,
} from "./helpers/flow-assistant-tools-fixtures";

test("getGraph returns a clone that cannot mutate internal state", async () => {
  const { tools, getResult } = createFlowAssistantTools({
    initialGraph: emptyGraph,
    allowedAgents,
  });

  await invokeTool(tools.setStart, { label: "Start", event: "pr_opened" });

  const snapshot = await invokeTool<{ graph: FlowGraph }>(tools.getGraph, {});
  snapshot.graph.nodes.push({
    id: "injected",
    type: "end",
    position: { x: 0, y: 0 },
    data: { label: "Injected" },
  });
  snapshot.graph.edges.push({ id: "bad", source: "x", target: "y" });

  const internal = getResult().graph;
  assert.equal(internal.nodes.length, 1);
  assert.equal(internal.nodes[0].id, "start");
  assert.equal(internal.edges.length, 0);
});

test("finalize returns errors when graph is invalid", async () => {
  const { tools, getResult } = createFlowAssistantTools({
    initialGraph: emptyGraph,
    allowedAgents,
  });

  const result = await invokeTool<{ ok: boolean; errors?: string[] }>(
    tools.finalize,
    { summary: "Test flow" }
  );

  assert.equal(result.ok, false);
  assert.ok(Array.isArray(result.errors));
  assert.ok(result.errors.length > 0);

  assert.equal(getResult().done, false);
  assert.equal(getResult().summary, null);
});

test("finalize returns ok and sets done on valid graph", async () => {
  const { tools, getResult } = createFlowAssistantTools({
    initialGraph: emptyGraph,
    allowedAgents,
  });

  await invokeTool(tools.setStart, { label: "PR opened", event: "pr_opened" });
  const agentResult = await invokeTool<{ id: string }>(tools.addAgentNode, {
    label: "Reviewer",
    agentId: "agent-1",
    role: "review",
  });
  await invokeTool(tools.setEnd, { label: "Done" });
  await invokeTool(tools.connect, { source: "start", target: agentResult.id });
  await invokeTool(tools.connect, { source: agentResult.id, target: "end" });

  const result = await invokeTool<{ ok: boolean; errors?: string[] }>(
    tools.finalize,
    { summary: "Reviews PRs when opened" }
  );

  assert.equal(result.ok, true);
  assert.equal(result.errors, undefined);

  const finalResult = getResult();
  assert.equal(finalResult.done, true);
  assert.equal(finalResult.summary, "Reviews PRs when opened");
});

test("finalize self-heal: fails on invalid graph, fixes, finalizes", async () => {
  const { tools, getResult } = createFlowAssistantTools({
    initialGraph: emptyGraph,
    allowedAgents,
  });

  await invokeTool(tools.setStart, { label: "PR opened", event: "pr_opened" });
  const firstAttempt = await invokeTool<{ ok: boolean; errors?: string[] }>(
    tools.finalize,
    { summary: "Premature" }
  );
  assert.equal(firstAttempt.ok, false);
  assert.ok(Array.isArray(firstAttempt.errors));
  assert.ok(firstAttempt.errors.length > 0);
  assert.equal(getResult().done, false);
  assert.equal(getResult().summary, null);

  const agent = await invokeTool<{ id: string }>(tools.addAgentNode, {
    label: "Reviewer",
    agentId: "agent-1",
    role: "review",
  });
  await invokeTool(tools.setEnd, { label: "Done" });
  await invokeTool(tools.connect, { source: "start", target: agent.id });
  await invokeTool(tools.connect, { source: agent.id, target: "end" });

  const secondAttempt = await invokeTool<{ ok: boolean; errors?: string[] }>(
    tools.finalize,
    { summary: "Reviews PRs when opened" }
  );
  assert.equal(secondAttempt.ok, true);
  assert.equal(secondAttempt.errors, undefined);

  const finalResult = getResult();
  assert.equal(finalResult.done, true);
  assert.equal(finalResult.summary, "Reviews PRs when opened");
});

test("getResult returns a clone that cannot mutate internal state", async () => {
  const { tools, getResult } = createFlowAssistantTools({
    initialGraph: emptyGraph,
    allowedAgents,
  });

  await invokeTool(tools.setStart, { label: "Start", event: "pr_opened" });

  const snapshot = getResult();
  snapshot.graph.nodes.push({
    id: "injected",
    type: "end",
    position: { x: 0, y: 0 },
    data: { label: "Injected" },
  });
  snapshot.graph.edges.push({ id: "bad", source: "x", target: "y" });

  const fresh = getResult();
  assert.equal(fresh.graph.nodes.length, 1);
  assert.equal(fresh.graph.nodes[0].id, "start");
  assert.equal(fresh.graph.edges.length, 0);
});

test("setStart replaces existing start node", async () => {
  const { tools, getResult } = createFlowAssistantTools({
    initialGraph: emptyGraph,
    allowedAgents,
  });

  await invokeTool(tools.setStart, { label: "First", event: "pr_opened" });
  assert.equal(getResult().graph.nodes.length, 1);
  assert.equal(getResult().graph.nodes[0].data.label, "First");

  await invokeTool(tools.setStart, { label: "Second", event: "mention" });

  const graph = getResult().graph;
  assert.equal(graph.nodes.length, 1);
  assert.equal(graph.nodes[0].data.label, "Second");
  const startNode = graph.nodes[0];
  assert.equal(startNode.type, "start");
  if (startNode.type === "start") {
    assert.equal(startNode.data.event, "mention");
  }
});

test("addConditionNode returns handles object", async () => {
  const { tools } = createFlowAssistantTools({
    initialGraph: emptyGraph,
    allowedAgents,
  });

  const result = await invokeTool<{
    id: string;
    handles: { then: string; else: string };
  }>(tools.addConditionNode, {
    label: "Check status",
    field: "status",
    operator: "equals",
    value: "open",
  });

  assert.ok(result.id);
  assert.ok(result.id.startsWith("condition-"));
  assert.deepEqual(result.handles, { then: "true", else: "false" });
});
