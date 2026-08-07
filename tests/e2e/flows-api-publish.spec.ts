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

test("PUT /api/flows/:id updates published flow installation without touching trigger-origin automations", async ({
  request,
}) => {
  await seedState(request, {
    installations: [
      {
        id: "inst-1",
        user_id: "user-1",
        installation_id: 101,
        account_login: "acme",
      },
      {
        id: "inst-2",
        user_id: "user-1",
        installation_id: 202,
        account_login: "acme-2",
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
        enabled: false,
      },
    ],
  });

  const installResponse = await request.put("/api/flows/flow-1", {
    headers: user1Headers,
    data: {
      installation_id: 202,
    },
  });
  expect(installResponse.ok()).toBeTruthy();

  const activatedResponse = await request.put("/api/flows/flow-1", {
    headers: user1Headers,
    data: { status: "active" },
  });
  expect(activatedResponse.ok()).toBeTruthy();

  const state = await getTestState(request);
  expect(state.flows[0].installation_id).toBe(202);
  expect(state.triggers[0].installation_id).toBe(101);
  expect(state.triggers[0].enabled).toBe(false);
});

test("PUT /api/flows/:id rejects activation for unpublished flows", async ({
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

  const response = await request.put("/api/flows/flow-1", {
    headers: user1Headers,
    data: { status: "active" },
  });

  expect(response.status()).toBe(400);
  expect(await response.json()).toMatchObject({
    code: "FLOW_UNPUBLISHED_ACTIVATION",
    error: "A flow must be published before it can be activated.",
  });
});

test("POST /api/flows/:id/publish atomically applies the draft installation scope", async ({
  request,
}) => {
  await seedState(request, {
    installations: [
      {
        id: "inst-1",
        user_id: "user-1",
        installation_id: 101,
        account_login: "webrenew",
      },
      {
        id: "inst-2",
        user_id: "user-1",
        installation_id: 202,
        account_login: "alex",
      },
    ],
    agents: [
      {
        id: "agent-1",
        user_id: "user-1",
        name: "Reviewer",
        slug: "reviewer",
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
              data: {
                label: "PR opened",
                event: "pr_opened",
                isDefault: true,
                filter: {
                  scope: "all",
                  installationIds: [202],
                  repos: ["alex/priority-project"],
                },
              },
            },
            {
              id: "agent-1",
              type: "agent",
              position: { x: 100, y: 0 },
              data: {
                label: "Reviewer",
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
  });

  const response = await request.post("/api/flows/flow-1/publish", {
    headers: user1Headers,
  });
  expect(response.ok()).toBeTruthy();

  const payload = await response.json();
  expect(payload.published_version_id).toBeTruthy();
  expect(payload.status).toBe("active");
  expect(payload.installation_id).toBe(202);

  const state = await getTestState(request);
  expect(state.flowVersions).toHaveLength(1);
  expect(state.flows[0]?.status).toBe("active");
  expect(state.flows[0]?.installation_id).toBe(202);
  expect(state.flowVersions[0]?.graph.nodes[0]?.data.filter).toEqual({
    scope: "all",
    installationIds: [202],
    repos: ["alex/priority-project"],
  });
  expect(state.triggers).toHaveLength(0);
});
