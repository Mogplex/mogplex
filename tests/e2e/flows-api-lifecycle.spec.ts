import { expect, test } from "@playwright/test";
import {
  user1Headers,
  seedState,
  resetState,
  getTestState,
} from "./helpers/flows-api-fixtures";

test.beforeEach(async ({ request }) => {
  await resetState(request);
});

test("POST /api/flows/:id/duplicate creates an inactive unlinked copy", async ({
  request,
}) => {
  await seedState(request, {
    flows: [
      {
        id: "flow-1",
        user_id: "user-1",
        installation_id: 101,
        name: "Original Flow",
        description: "desc",
        notes: "notes",
        source_kind: "github",
        status: "active",
        draft_graph: {
          nodes: [],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        published_version_id: "version-1",
        created_at: "2026-03-28T10:00:00.000Z",
        updated_at: "2026-03-28T10:00:00.000Z",
      },
    ],
  });

  const response = await request.post("/api/flows/flow-1/duplicate", {
    headers: user1Headers,
  });
  expect(response.status()).toBe(201);

  const payload = await response.json();
  expect(payload.name).toBe("Original Flow Copy");
  expect(payload.status).toBe("inactive");
  expect(payload.published_version_id).toBeNull();
});

test("DELETE /api/flows/:id deletes the flow and leaves trigger-origin automations untouched", async ({
  request,
}) => {
  await seedState(request, {
    flows: [
      {
        id: "flow-1",
        user_id: "user-1",
        installation_id: 101,
        name: "Flow",
        description: null,
        notes: null,
        source_kind: "github",
        status: "active",
        draft_graph: {
          nodes: [],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        published_version_id: "version-1",
        created_at: "2026-03-28T10:00:00.000Z",
        updated_at: "2026-03-28T10:00:00.000Z",
      },
    ],
    flowVersions: [
      {
        id: "version-1",
        flow_id: "flow-1",
        version_number: 1,
        graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
        created_at: "2026-03-28T10:00:00.000Z",
      },
    ],
    triggers: [
      {
        id: "trigger-1",
        user_id: "user-1",
        installation_id: 101,
        agent_id: "agent-1",
        event: "mention",
        is_default: true,
        enabled: true,
      },
    ],
  });

  const response = await request.delete("/api/flows/flow-1", {
    headers: user1Headers,
  });
  expect(response.ok()).toBeTruthy();

  const state = await getTestState(request);
  expect(state.flows).toHaveLength(0);
  expect(state.triggers).toHaveLength(1);
});

test("DELETE /api/flows/:id fails cleanly without mutating trigger-origin automations", async ({
  request,
}) => {
  await seedState(request, {
    flows: [
      {
        id: "flow-1",
        user_id: "user-1",
        installation_id: 101,
        name: "Flow",
        description: null,
        notes: null,
        source_kind: "github",
        status: "active",
        draft_graph: {
          nodes: [],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        published_version_id: "version-1",
        created_at: "2026-03-28T10:00:00.000Z",
        updated_at: "2026-03-28T10:00:00.000Z",
      },
    ],
    flowVersions: [
      {
        id: "version-1",
        flow_id: "flow-1",
        version_number: 1,
        graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
        created_at: "2026-03-28T10:00:00.000Z",
      },
    ],
    triggers: [
      {
        id: "trigger-1",
        user_id: "user-1",
        installation_id: 101,
        agent_id: "agent-1",
        event: "mention",
        is_default: true,
        enabled: true,
      },
    ],
    faults: {
      failNextFlowDelete: "flow delete failed",
    },
  });

  const response = await request.delete("/api/flows/flow-1", {
    headers: user1Headers,
  });
  expect(response.status()).toBe(500);
  expect(await response.json()).toMatchObject({
    code: "FLOW_DELETE_SYNC_FAILED",
    error: "flow delete failed",
  });

  const state = await getTestState(request);
  expect(state.flows).toHaveLength(1);
  expect(state.triggers).toHaveLength(1);
  expect(state.triggers[0].id).toBe("trigger-1");
});

test("POST /api/flows/:id/assistant validates request and response graphs", async ({
  request,
}) => {
  await seedState(request, {
    flows: [
      {
        id: "flow-1",
        user_id: "user-1",
        installation_id: 101,
        name: "Flow",
        description: null,
        notes: null,
        source_kind: "github",
        status: "inactive",
        draft_graph: {
          nodes: [
            {
              id: "start",
              type: "start",
              position: { x: 0, y: 0 },
              data: { label: "@mention", event: "mention", isDefault: true },
            },
            {
              id: "agent-1",
              type: "agent",
              position: { x: 100, y: 0 },
              data: {
                label: "Agent",
                agentId: "agent-1",
                modelOverride: "minimax/minimax-m2.5",
              },
            },
            {
              id: "end",
              type: "end",
              position: { x: 200, y: 0 },
              data: { label: "Done" },
            },
          ],
          edges: [
            { id: "e1", source: "start", target: "agent-1" },
            { id: "e2", source: "agent-1", target: "end" },
          ],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        published_version_id: null,
        created_at: "2026-03-28T10:00:00.000Z",
        updated_at: "2026-03-28T10:00:00.000Z",
      },
    ],
    assistant: {
      nextResult: {
        summary: "Added a parallel reviewer",
        graph: {
          nodes: [
            {
              id: "start",
              type: "start",
              position: { x: 0, y: 0 },
              data: { label: "@mention", event: "mention", isDefault: true },
            },
            {
              id: "agent-1",
              type: "agent",
              position: { x: 100, y: 0 },
              data: {
                label: "Agent",
                agentId: "agent-1",
                modelOverride: "minimax/minimax-m2.5",
              },
            },
            {
              id: "end",
              type: "end",
              position: { x: 200, y: 0 },
              data: { label: "Done" },
            },
          ],
          edges: [
            { id: "e1", source: "start", target: "agent-1" },
            { id: "e2", source: "agent-1", target: "end" },
          ],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
      },
    },
  });

  const successResponse = await request.post("/api/flows/flow-1/assistant", {
    headers: user1Headers,
    data: { message: "Keep it simple" },
  });
  expect(successResponse.ok()).toBeTruthy();
  expect(await successResponse.json()).toMatchObject({
    summary: "Added a parallel reviewer",
  });

  const missingMessage = await request.post("/api/flows/flow-1/assistant", {
    headers: user1Headers,
    data: { message: "" },
  });
  expect(missingMessage.status()).toBe(400);

  await seedState(request, {
    flows: [
      {
        id: "flow-1",
        user_id: "user-1",
        installation_id: 101,
        name: "Flow",
        description: null,
        notes: null,
        source_kind: "github",
        status: "inactive",
        draft_graph: {
          nodes: [],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        published_version_id: null,
        created_at: "2026-03-28T10:00:00.000Z",
        updated_at: "2026-03-28T10:00:00.000Z",
      },
    ],
    assistant: {
      nextResult: {
        summary: "Broken graph",
        graph: {
          nodes: [
            {
              id: "start",
              type: "start",
              position: { x: 0, y: 0 },
              data: { label: "@mention", event: "mention", isDefault: true },
            },
          ],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
      },
    },
  });

  const invalidGraph = await request.post("/api/flows/flow-1/assistant", {
    headers: user1Headers,
    data: { message: "Break it" },
  });
  expect(invalidGraph.status()).toBe(400);
  expect(await invalidGraph.json()).toMatchObject({
    code: "FLOW_ASSISTANT_INVALID_GRAPH",
    error: "Assistant produced an invalid flow graph",
  });
});
