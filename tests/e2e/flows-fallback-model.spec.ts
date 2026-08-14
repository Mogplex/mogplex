import { expect, test } from "@playwright/test";
import {
  E2E_SCOPE_USER,
  enableScopedE2EAuth,
  scopedPath,
} from "./helpers/auth";
import { linkedVercelCapability } from "./helpers/activation-fixtures";
import { capturePageErrors } from "./helpers/page-errors";
import type { Route } from "@playwright/test";
import type { FlowNode } from "../../lib/types";

const connectedUser = {
  id: E2E_SCOPE_USER.id,
  email: "alex@example.com",
  username: E2E_SCOPE_USER.username,
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

const graph = {
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
      data: {
        label: "Reviewer A",
        agentId: "agent-a",
        modelOverride: "minimax/minimax-m2.5",
      },
    },
    {
      id: "end",
      type: "end",
      position: { x: 900, y: 160 },
      data: { label: "Done" },
    },
  ],
  edges: [
    { id: "edge-1", source: "start", target: "agent-a" },
    { id: "edge-2", source: "agent-a", target: "end" },
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
};

const modelFixture = {
  provider: "minimax",
  context_length: 200000,
  capabilities: ["text"],
  is_available: true,
  is_hidden: false,
};

test("flows inspector saves a user-picked fallback model for upstream issues", async ({
  page,
}) => {
  const pageErrors = capturePageErrors(page);
  // Width must be >= 1520 so the flows container (minus ~240px sidebar) exceeds
  // the 1280px dock-mode threshold.
  await page.setViewportSize({ width: 1600, height: 900 });
  await enableScopedE2EAuth(page);

  let currentFlow = {
    id: "flow-1",
    installation_id: 101,
    name: "Review Flow",
    description: "Flow description",
    notes: "Flow notes",
    source_kind: "github",
    status: "active",
    last_run_status: "success",
    published_version_id: "version-1",
    published_version: {
      id: "version-1",
      flow_id: "flow-1",
      version_number: 1,
      graph,
      created_at: "2026-03-28T17:00:00.000Z",
    },
    draft_graph: graph,
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
        { ...modelFixture, id: "minimax/minimax-m2.5", name: "MiniMax M2.5" },
        {
          ...modelFixture,
          id: "openai/gpt-5.4",
          provider: "openai",
          name: "GPT-5.4",
        },
      ],
      catalog: [
        {
          ...modelFixture,
          id: "minimax/minimax-m2.5",
          name: "MiniMax M2.5",
          is_enabled: true,
        },
        {
          ...modelFixture,
          id: "openai/gpt-5.4",
          provider: "openai",
          name: "GPT-5.4",
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
    const payload = route.request().postDataJSON() as Partial<
      typeof currentFlow
    >;
    currentFlow = {
      ...currentFlow,
      ...payload,
      draft_graph: payload.draft_graph ?? currentFlow.draft_graph,
    };
    await fulfillJson(route, currentFlow);
  });
  await page.route("**/api/flows/flow-1/runs?limit=12", (route) =>
    fulfillJson(route, { runs: [] })
  );

  await page.goto(scopedPath("workflows"));
  await page.waitForLoadState("networkidle");

  const agentNode = page.getByTestId("rf__node-agent-a");
  await agentNode.click();
  await expect(page.locator(".flows-inspector")).toBeVisible();

  // Unset by default: the shared fallback pool applies.
  const fallbackSelect = page.getByLabel("Fallback model", { exact: true });
  await expect(fallbackSelect).toBeVisible();
  await expect(fallbackSelect).toHaveAttribute("data-value", "");

  await fallbackSelect.click();
  await page.locator('[role="option"][data-value="openai/gpt-5.4"]').click();
  await expect(fallbackSelect).toHaveAttribute("data-value", "openai/gpt-5.4");

  await page.getByTestId("flows-inspector-close").click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect
    .poll(() => {
      const agent = (currentFlow.draft_graph.nodes as FlowNode[]).find(
        (node): node is Extract<FlowNode, { type: "agent" }> =>
          node.id === "agent-a" && node.type === "agent"
      );
      return agent?.data.fallbackModelOverride;
    })
    .toBe("openai/gpt-5.4");
  expect(pageErrors).toEqual([]);
});
