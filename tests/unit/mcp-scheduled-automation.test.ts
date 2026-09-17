import assert from "node:assert/strict";
import test from "node:test";
import { coerceGraph, validateFlowGraph } from "../../lib/flows/graph";
import { handleMogplexMcpPayload } from "../../lib/mogplex-api/mcp";
import { buildFakeMcpClient } from "./helpers/mogplex-api-mcp-fixtures";

function scheduledGraph(role: string) {
  return coerceGraph({
    nodes: [
      {
        id: "start",
        type: "start",
        position: { x: 0, y: 0 },
        data: {
          label: "Daily",
          event: "schedule",
          scheduleCron: "10 7 * * *",
          scheduleTimezone: "UTC",
          filter: {
            scope: "org",
            installationIds: [123],
            repos: ["acme/widgets"],
          },
        },
      },
      {
        id: "review",
        type: "agent",
        position: { x: 200, y: 0 },
        data: {
          label: "Inspect",
          harness: "claude-code",
          agentId: null,
          role: "review",
        },
      },
      {
        id: "work",
        type: "agent",
        position: { x: 400, y: 0 },
        data: {
          label: "Apply",
          harness: "claude-code",
          agentId: null,
          role,
          systemPromptOverride:
            "Check the repository. Open a PR only when changes are needed.",
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
      { id: "a", source: "start", target: "review" },
      { id: "b", source: "review", target: "work" },
      { id: "c", source: "work", target: "end" },
    ],
  });
}

test("publish validation rejects a scheduled PR fix even with an upstream review", () => {
  const result = validateFlowGraph(scheduledGraph("edit"));
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /existing pull request.*task/i);
});

test("scheduled task survives graph serialization and does not require a review", () => {
  const graph = scheduledGraph("task");
  graph.nodes = graph.nodes.filter((node) => node.id !== "review");
  graph.edges = [
    { id: "a", source: "start", target: "work" },
    { id: "b", source: "work", target: "end" },
  ];
  const task = graph.nodes.find((node) => node.id === "work");
  assert.ok(task?.type === "agent");
  assert.equal(task.data.role, "task");
  assert.deepEqual(validateFlowGraph(graph), { valid: true, errors: [] });
});

test("MCP exposes a schedule recipe and graph fields without source access", async () => {
  const result = await handleMogplexMcpPayload(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "mogplex_get_automation_schema", arguments: {} },
    },
    { client: buildFakeMcpClient() }
  );
  assert.ok(result && !Array.isArray(result) && "result" in result);
  const serialized = JSON.stringify(result.result);
  assert.match(serialized, /scheduleCron/);
  assert.match(serialized, /scheduleTimezone/);
  assert.match(serialized, /systemPromptOverride/);
  assert.match(serialized, /"task"/);
  assert.match(serialized, /preset:/);
});

test("scheduled tasks reject unsupported flags, missing instructions and incompatible triggers", () => {
  for (const flag of [
    "autoMerge",
    "autofix",
    "autoRevert",
    "requireApproval",
  ] as const) {
    const graph = scheduledGraph("task");
    const task = graph.nodes.find((node) => node.id === "work");
    assert.ok(task?.type === "agent");
    task.data[flag] = true;
    assert.equal(validateFlowGraph(graph).valid, false, flag);
  }
  const graph = scheduledGraph("task");
  const task = graph.nodes.find((node) => node.id === "work");
  assert.ok(task?.type === "agent");
  task.data.systemPromptOverride = " ";
  assert.match(validateFlowGraph(graph).errors.join(" "), /needs instructions/);
  assert.equal(
    validateFlowGraph(graph, { requireRunnableConfig: false }).valid,
    true
  );
  task.data.systemPromptOverride = "Check the repository";
  const start = graph.nodes.find((node) => node.type === "start")!;
  start.data.event = "push";
  assert.match(
    validateFlowGraph(graph).errors.join(" "),
    /requires a schedule trigger/
  );
});
