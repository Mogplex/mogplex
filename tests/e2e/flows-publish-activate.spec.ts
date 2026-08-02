import { expect, test } from "@playwright/test";
import { buildE2EAuthHeaders } from "./helpers/auth";
import { linkedVercelCapability } from "./helpers/activation-fixtures";
import type { Route } from "@playwright/test";

const connectedUser = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "alex@example.com",
  username: "alex",
  name: "Alex",
  avatar_url: "https://example.com/avatar.png",
  github_connected: true,
  github_app_connected: true,
  github_app_available: true,
  github_connection_mode: "app" as const,
  vercel: linkedVercelCapability,
};

async function fulfillJson(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(data),
  });
}

type TestFlowPayload = {
  id: string;
  installation_id: number;
  name: string;
  description: string;
  notes: string;
  source_kind: "github";
  status: "active" | "inactive";
  last_run_status: string | null;
  published_version_id: string | null;
  published_version: {
    id: string;
    flow_id: string;
    version_number: number;
    graph: Record<string, unknown>;
    created_at: string;
  } | null;
  draft_graph: {
    nodes: Array<Record<string, unknown>>;
    edges: Array<Record<string, unknown>>;
    viewport: { x: number; y: number; zoom: number };
  };
};

test("publishing a flow makes it live without a separate activation step", async ({
  page,
}) => {
  await page.context().setExtraHTTPHeaders({
    ...buildE2EAuthHeaders(connectedUser.id),
    "x-mogplex-scope-kind": "personal",
    "x-mogplex-scope-slug": connectedUser.username,
    "x-mogplex-scope-id": connectedUser.id,
  });
  await page.addInitScript(() => {
    window.localStorage.setItem("theme", "dark");
  });

  let publishCalls = 0;
  const statusUpdates: Array<"active" | "inactive"> = [];
  let currentFlow: TestFlowPayload = {
    id: "flow-1",
    installation_id: 101,
    name: "Review Flow",
    description: "Flow description",
    notes: "Flow notes",
    source_kind: "github",
    status: "inactive" as const,
    last_run_status: null,
    published_version_id: null as string | null,
    published_version: null as {
      id: string;
      flow_id: string;
      version_number: number;
      graph: Record<string, unknown>;
      created_at: string;
    } | null,
    draft_graph: {
      nodes: [
        {
          id: "start",
          type: "start",
          position: { x: 120, y: 160 },
          data: { label: "PR opened", event: "pr_opened" },
        },
        {
          id: "agent-a",
          type: "agent",
          position: { x: 380, y: 160 },
          data: { label: "Reviewer A", agentId: "agent-a" },
        },
        {
          id: "end",
          type: "end",
          position: { x: 660, y: 160 },
          data: { label: "Done" },
        },
      ],
      edges: [
        { id: "edge-1", source: "start", target: "agent-a" },
        { id: "edge-2", source: "agent-a", target: "end" },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  };

  await page.route("**/api/auth/user", (route) =>
    fulfillJson(route, { user: connectedUser })
  );
  await page.route("**/api/settings", (route) =>
    fulfillJson(route, { default_model: "minimax/minimax-m2.5", theme: "dark" })
  );
  await page.route("**/api/models", (route) =>
    fulfillJson(route, {
      models: [
        {
          id: "minimax/minimax-m2.5",
          provider: "minimax",
          name: "MiniMax M2.5",
          context_length: 200000,
          capabilities: ["text"],
          is_available: true,
        },
      ],
      catalog: [
        {
          id: "minimax/minimax-m2.5",
          provider: "minimax",
          name: "MiniMax M2.5",
          context_length: 200000,
          capabilities: ["text"],
          is_available: true,
          is_enabled: true,
        },
      ],
    })
  );
  await page.route("**/api/agents", (route) =>
    fulfillJson(route, [
      {
        id: "agent-a",
        name: "Reviewer A",
        slug: "reviewer-a",
        model: "minimax/minimax-m2.5",
      },
    ])
  );
  await page.route("**/api/github/installations", (route) =>
    fulfillJson(route, [
      {
        id: "inst-1",
        installation_id: 101,
        account_login: "webrenew",
        repositories: [{ id: "repo-1", full_name: "webrenew/blackbox" }],
      },
    ])
  );
  await page.route("**/api/flows", (route) =>
    fulfillJson(route, [currentFlow])
  );
  await page.route("**/api/flows/flow-1", async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, currentFlow);
      return;
    }

    const payload = route.request().postDataJSON() as Partial<TestFlowPayload>;
    if (payload.status === "active" || payload.status === "inactive") {
      statusUpdates.push(payload.status);
    }

    currentFlow = {
      ...currentFlow,
      ...payload,
      draft_graph: payload.draft_graph ?? currentFlow.draft_graph,
    };
    await fulfillJson(route, currentFlow);
  });
  await page.route("**/api/flows/flow-1/publish", async (route) => {
    publishCalls += 1;
    const publishedGraph = structuredClone(currentFlow.draft_graph);
    currentFlow = {
      ...currentFlow,
      status: "active",
      published_version_id: "version-1",
      published_version: {
        id: "version-1",
        flow_id: "flow-1",
        version_number: 1,
        graph: publishedGraph,
        created_at: "2026-03-28T17:00:00.000Z",
      },
    };
    await fulfillJson(route, currentFlow);
  });
  await page.route("**/api/flows/flow-1/runs?limit=12", (route) =>
    fulfillJson(route, { runs: [] })
  );

  await page.goto("/alex/workflows");
  await page.waitForLoadState("networkidle");

  const publishButton = page.getByRole("button", {
    name: "Publish & activate",
  });
  await expect(publishButton).toBeVisible();

  await publishButton.click();

  await expect.poll(() => publishCalls).toBe(1);
  await expect.poll(() => currentFlow.status).toBe("active");
  await expect(page.getByTestId("flow-publish-button")).toContainText(
    "Published"
  );
  await expect(statusUpdates).toEqual([]);

  await page.reload();
  await page.waitForLoadState("networkidle");

  const cleanPublishButton = page.getByTestId("flow-publish-button");
  await expect(cleanPublishButton).toHaveText("Publish changes");
  await expect(cleanPublishButton).toBeDisabled();
  expect(publishCalls).toBe(1);

  await page.getByRole("button", { name: "Add agent" }).click();
  await expect(cleanPublishButton).toBeEnabled();
});
