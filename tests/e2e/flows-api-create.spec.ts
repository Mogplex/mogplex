import { expect, test } from "@playwright/test";
import {
  user1Headers,
  user2Headers,
  seedState,
  resetState,
  getTestState,
} from "./helpers/flows-api-fixtures";

test.beforeEach(async ({ request }) => {
  await resetState(request);
});

test("POST /api/flows creates an inactive default flow for an owned installation", async ({
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
    ],
    agents: [
      {
        id: "agent-a",
        user_id: "user-1",
        name: "First Agent",
        slug: "first-agent",
        model: "minimax/minimax-m2.5",
        system_prompt: null,
      },
      {
        id: "agent-b",
        user_id: "user-1",
        name: "Second Agent",
        slug: "second-agent",
        model: "minimax/minimax-m2.5",
        system_prompt: null,
      },
    ],
  });

  const response = await request.post("/api/flows", {
    headers: user1Headers,
    data: {
      installation_id: 101,
      name: "New Flow",
    },
  });
  expect(response.status()).toBe(201);

  const payload = await response.json();
  expect(payload.name).toBe("New Flow");
  expect(payload.status).toBe("inactive");
  expect(
    payload.draft_graph.nodes.find(
      (node: { type: string }) => node.type === "agent"
    ).data.agentId
  ).toBe("agent-a");
});

test("POST /api/flows creates a validated workflow starter template", async ({
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
    ],
    agents: [
      {
        id: "agent-a",
        user_id: "user-1",
        name: "Primary Agent",
        slug: "primary-agent",
        model: "minimax/minimax-m2.5",
        system_prompt: null,
      },
    ],
  });

  const invalidResponse = await request.post("/api/flows", {
    headers: user1Headers,
    data: {
      installation_id: 101,
      template_id: "not-a-template",
    },
  });
  expect(invalidResponse.status()).toBe(400);

  const response = await request.post("/api/flows", {
    headers: user1Headers,
    data: {
      installation_id: 101,
      template_id: "dependabot-autopilot",
    },
  });
  expect(response.status()).toBe(201);

  const payload = await response.json();
  const startNode = payload.draft_graph.nodes.find(
    (node: { type: string }) => node.type === "start"
  );
  const agentNode = payload.draft_graph.nodes.find(
    (node: { type: string }) => node.type === "agent"
  );
  expect(payload.name).toBe("Dependabot autopilot");
  expect(payload.description).toBe(
    "Review, repair, and merge safe Dependabot updates."
  );
  expect(startNode.data.event).toBe("pr_opened");
  expect(startNode.data.filter.authorFilter).toBe("dependabot_only");
  expect(agentNode.data.agentId).toBe("agent-a");
  expect(agentNode.data.autofixSandbox).toBe(true);
  expect(agentNode.data.autoMerge).toBe(true);
});

test("personal workflow templates are private, sanitized, and rebound on creation", async ({
  request,
}) => {
  const sourceGraph = {
    nodes: [
      {
        id: "start",
        type: "start",
        position: { x: 80, y: 140 },
        data: {
          label: "PR opened",
          event: "pr_opened",
          filter: {
            scope: "all",
            installationIds: [101],
            repos: ["acme/source"],
          },
        },
      },
      {
        id: "agent",
        type: "agent",
        position: { x: 360, y: 140 },
        data: {
          label: "Primary Agent",
          agentId: "agent-a",
          role: "review",
          modelOverride: "minimax/minimax-m2.5",
        },
      },
      {
        id: "end",
        type: "end",
        position: { x: 640, y: 140 },
        data: { label: "Done" },
      },
    ],
    edges: [
      { id: "start-agent", source: "start", target: "agent" },
      { id: "agent-end", source: "agent", target: "end" },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };

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
        account_login: "alex",
      },
      {
        id: "inst-3",
        user_id: "user-2",
        installation_id: 303,
        account_login: "other",
      },
    ],
    agents: [
      {
        id: "agent-a",
        user_id: "user-1",
        name: "Primary Agent",
        slug: "primary-agent",
        model: "minimax/minimax-m2.5",
        system_prompt: null,
      },
    ],
    flows: [
      {
        id: "flow-source",
        user_id: "user-1",
        installation_id: 101,
        name: "Critical review",
        description: "Extra checks for high-risk repositories.",
        notes: null,
        source_kind: "github",
        status: "inactive",
        draft_graph: sourceGraph,
        published_version_id: null,
        created_at: "2026-07-24T10:00:00.000Z",
        updated_at: "2026-07-24T10:00:00.000Z",
      },
    ],
  });

  const saveResponse = await request.post("/api/flows/templates", {
    headers: user1Headers,
    data: {
      flow_id: "flow-source",
      name: "Strict PR review",
    },
  });
  expect(saveResponse.status()).toBe(201);
  const saved = await saveResponse.json();
  expect(saved.name).toBe("Strict PR review");
  expect(saved.source_flow_id).toBe("flow-source");
  expect(saved.graph).toBeUndefined();
  const stateAfterSave = await getTestState(request);
  expect(stateAfterSave.flowTemplates[0]?.graph.nodes[0]?.data.filter).toEqual({
    scope: "all",
  });

  const ownerList = await request.get("/api/flows/templates", {
    headers: user1Headers,
  });
  expect(ownerList.status()).toBe(200);
  expect((await ownerList.json()).templates).toHaveLength(1);

  const otherUserList = await request.get("/api/flows/templates", {
    headers: user2Headers,
  });
  expect(otherUserList.status()).toBe(200);
  expect(await otherUserList.json()).toEqual({
    templates: [],
    next_cursor: null,
  });

  const createResponse = await request.post("/api/flows", {
    headers: user1Headers,
    data: {
      installation_id: 202,
      personal_template_id: saved.id,
      repo_full_name: "alex/priority-project",
    },
  });
  expect(createResponse.status()).toBe(201);
  const created = await createResponse.json();
  expect(created.name).toBe("Strict PR review");
  expect(created.status).toBe("inactive");
  expect(created.published_version_id).toBeNull();
  expect(created.draft_graph.nodes[0].data.filter).toEqual({
    scope: "all",
    installationIds: [202],
    repos: ["alex/priority-project"],
  });

  const forbiddenCreate = await request.post("/api/flows", {
    headers: user2Headers,
    data: {
      installation_id: 303,
      personal_template_id: saved.id,
    },
  });
  expect(forbiddenCreate.status()).toBe(404);
});
