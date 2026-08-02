import assert from "node:assert/strict";
import test from "node:test";
import type { Flow, FlowGraph } from "../../lib/types";

async function loadRoute() {
  return import("../../app/api/flows/[id]/test-trigger/route");
}

const graph: FlowGraph = {
  nodes: [
    {
      id: "start",
      type: "start",
      position: { x: 0, y: 0 },
      data: {
        label: "Webhook",
        event: "webhook",
        filter: { scope: "all", repos: ["acme/web"] },
      },
    },
    {
      id: "agent",
      type: "agent",
      position: { x: 200, y: 0 },
      data: { label: "Review", agentId: "agent-1", role: "review" },
    },
    {
      id: "end",
      type: "end",
      position: { x: 400, y: 0 },
      data: { label: "Done" },
    },
  ],
  edges: [
    { id: "e1", source: "start", target: "agent" },
    { id: "e2", source: "agent", target: "end" },
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
};

function flow(status: Flow["status"]): Flow {
  return {
    id: "flow-1",
    user_id: "user-1",
    installation_id: 123,
    name: "Release hook",
    description: null,
    notes: null,
    source_kind: "webhook",
    status,
    draft_graph: graph,
    published_version_id: "version-1",
    created_at: "2026-07-23T00:00:00.000Z",
    updated_at: "2026-07-23T00:00:00.000Z",
    published_version: {
      id: "version-1",
      flow_id: "flow-1",
      version_number: 1,
      graph,
      created_at: "2026-07-23T00:00:00.000Z",
    },
  };
}

test("test trigger dispatches the immutable published event for its owner", async () => {
  const { createFlowTestTriggerPostHandler } = await loadRoute();
  const calls: unknown[] = [];
  const response = await createFlowTestTriggerPostHandler({
    requireUserId: async () => "user-1",
    loadOwnedFlow: async () => flow("active"),
    randomId: () => "test-1",
    dispatch: async (input) => {
      calls.push(input);
      return {
        matched: true,
        outcome: "queued",
        jobRunId: "run-1",
        started: true,
        reason: null,
      };
    },
  })(
    new Request("http://localhost/api/flows/flow-1/test-trigger", {
      method: "POST",
      body: JSON.stringify({ payload: { release: "1.2.3" } }),
      headers: { "content-type": "application/json" },
    }),
    { params: Promise.resolve({ id: "flow-1" }) }
  );

  assert.equal(response.status, 202);
  assert.deepEqual(calls, [
    {
      flowId: "flow-1",
      event: "webhook",
      expectedUserId: "user-1",
      idempotencyKey: "flow-test:flow-1:test-1",
      payload: { release: "1.2.3" },
      startSource: "api",
    },
  ]);
});

test("test trigger requires an active published workflow", async () => {
  const { createFlowTestTriggerPostHandler } = await loadRoute();
  const response = await createFlowTestTriggerPostHandler({
    requireUserId: async () => "user-1",
    loadOwnedFlow: async () => flow("inactive"),
  })(
    new Request("http://localhost/api/flows/flow-1/test-trigger", {
      method: "POST",
    }),
    { params: Promise.resolve({ id: "flow-1" }) }
  );

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /publish and activate/i);
});
