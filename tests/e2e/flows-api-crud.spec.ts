import { expect, test } from "@playwright/test";
import {
  user1Headers,
  user2Headers,
  seedState,
  resetState,
} from "./helpers/flows-api-fixtures";

test.beforeEach(async ({ request }) => {
  await resetState(request);
});

test("GET /api/flows/:id enforces ownership", async ({ request }) => {
  await seedState(request, {
    flows: [
      {
        id: "flow-1",
        user_id: "user-1",
        installation_id: 101,
        name: "Owned Flow",
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
  });

  const okResponse = await request.get("/api/flows/flow-1", {
    headers: user1Headers,
  });
  expect(okResponse.ok()).toBeTruthy();

  const missingResponse = await request.get("/api/flows/flow-1", {
    headers: user2Headers,
  });
  expect(missingResponse.status()).toBe(404);
});

test("PUT /api/flows/:id updates metadata and rejects foreign agent bindings", async ({
  request,
}) => {
  await seedState(request, {
    agents: [
      {
        id: "agent-owned",
        user_id: "user-1",
        name: "Owned Agent",
        slug: "owned",
        model: "minimax/minimax-m2.5",
        system_prompt: null,
      },
      {
        id: "agent-foreign",
        user_id: "user-2",
        name: "Foreign Agent",
        slug: "foreign",
        model: "minimax/minimax-m2.5",
        system_prompt: null,
      },
    ],
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
              data: { label: "Owned Agent", agentId: "agent-owned" },
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
  });

  const okResponse = await request.put("/api/flows/flow-1", {
    headers: user1Headers,
    data: {
      name: "Updated Flow",
      description: "Updated description",
      notes: "Updated notes",
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
            data: { label: "Owned Agent", agentId: "agent-owned" },
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
        viewport: { x: 5, y: 5, zoom: 1.1 },
      },
    },
  });
  expect(okResponse.ok()).toBeTruthy();
  const updated = await okResponse.json();
  expect(updated.name).toBe("Updated Flow");
  expect(updated.description).toBe("Updated description");
  expect(updated.notes).toBe("Updated notes");

  const badResponse = await request.put("/api/flows/flow-1", {
    headers: user1Headers,
    data: {
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
            data: { label: "Foreign Agent", agentId: "agent-foreign" },
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
  });
  expect(badResponse.status()).toBe(400);
  expect(await badResponse.json()).toMatchObject({
    code: "FLOW_AGENT_FORBIDDEN",
    error: expect.stringContaining('Agent "agent-foreign"'),
  });
});

test("GET /api/flows/templates pages summaries without returning stored graphs", async ({
  request,
}) => {
  await seedState(request, {
    flowTemplates: Array.from({ length: 26 }, (_, index) => ({
      id: `template-${String(index).padStart(2, "0")}`,
      user_id: "user-1",
      name: `Template ${index + 1}`,
      description: null,
      graph: {
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
      source_flow_id: null,
      trigger_event: "pr_opened",
      reconnect: [],
      requires_repository: false,
      created_at: `2026-07-24T10:${String(index).padStart(2, "0")}:00.000Z`,
      updated_at: `2026-07-24T10:${String(index).padStart(2, "0")}:00.000Z`,
    })),
  });

  const firstResponse = await request.get("/api/flows/templates", {
    headers: user1Headers,
  });
  expect(firstResponse.status()).toBe(200);
  const firstPage = await firstResponse.json();
  expect(firstPage.templates).toHaveLength(25);
  expect(firstPage.next_cursor).toBe("25");
  expect(firstPage.templates[0].graph).toBeUndefined();

  const secondResponse = await request.get(
    `/api/flows/templates?cursor=${firstPage.next_cursor}`,
    { headers: user1Headers }
  );
  expect(secondResponse.status()).toBe(200);
  expect(await secondResponse.json()).toMatchObject({
    templates: [{ name: "Template 1" }],
    next_cursor: null,
  });

  const invalidResponse = await request.get("/api/flows/templates?cursor=1.5", {
    headers: user1Headers,
  });
  expect(invalidResponse.status()).toBe(400);
});
