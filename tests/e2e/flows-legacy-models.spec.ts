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

test("flows inspector highlights legacy hidden model overrides and supports quick replacement", async ({
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
      graph: {
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
              modelOverride: "openai/o1",
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
      },
      created_at: "2026-03-28T17:00:00.000Z",
    },
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
          data: {
            label: "Reviewer A",
            agentId: "agent-a",
            modelOverride: "openai/o1",
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
          is_hidden: false,
        },
        {
          id: "openai/gpt-5.4",
          provider: "openai",
          name: "GPT-5.4",
          context_length: 200000,
          capabilities: ["text"],
          is_available: true,
          is_hidden: false,
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
          is_hidden: false,
          is_enabled: true,
        },
        {
          id: "openai/gpt-5.4",
          provider: "openai",
          name: "GPT-5.4",
          context_length: 200000,
          capabilities: ["text"],
          is_available: true,
          is_hidden: false,
          is_enabled: true,
        },
        {
          id: "openai/o1",
          provider: "openai",
          name: "OpenAI o1",
          context_length: 200000,
          capabilities: ["text"],
          is_available: true,
          is_hidden: true,
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
  await page.route("**/api/flows", async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, [currentFlow]);
      return;
    }

    const payload = route.request().postDataJSON() as typeof currentFlow;
    currentFlow = {
      ...currentFlow,
      ...payload,
      draft_graph: payload.draft_graph,
    };
    await fulfillJson(route, currentFlow, 201);
  });
  await page.route("**/api/flows/flow-1", async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, currentFlow);
      return;
    }

    const payload = route.request().postDataJSON() as Partial<
      typeof currentFlow
    > & { draft_graph: typeof currentFlow.draft_graph };
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

  await expect(page.getByTestId("flows-legacy-model-banner")).toBeVisible();

  const agentNode = page.getByTestId("rf__node-agent-a");
  await agentNode.click();
  // Selecting a node opens the inspector on its own now; the separate
  // `.flows-inspector-toggle` control no longer exists.
  await expect(page.locator(".flows-inspector")).toBeVisible();
  expect(pageErrors).toEqual([]);
  await expect(page.getByTestId("flows-legacy-model-warning")).toBeVisible();
  await expect(
    page.getByText("This node override is not enabled for this account.")
  ).toBeVisible();
  // The override is kept selected and labelled rather than silently blanked --
  // see `buildAgentModelOptions`, which prepends a "Legacy · " entry for a
  // current model that is no longer in the enabled catalogue. Blanking it would
  // misreport what the node is actually configured to run.
  const modelSelect = page.getByLabel("Model", { exact: true });
  await expect(modelSelect).toHaveAttribute("data-value", "openai/o1");
  await modelSelect.click();
  const legacyOption = page.locator('[role="option"][data-value="openai/o1"]');
  await expect(legacyOption).toHaveCount(1);
  await expect(legacyOption).toHaveText("Legacy · openai/o1");
  await legacyOption.click();

  await page.getByTestId("flows-legacy-model-replace").click();
  await expect(modelSelect).toHaveAttribute(
    "data-value",
    "minimax/minimax-m2.5"
  );
  await modelSelect.click();
  await expect(
    page.locator('[role="option"][data-value="openai/o1"]')
  ).toHaveCount(0);
  await page
    .locator('[role="option"][data-value="minimax/minimax-m2.5"]')
    .click();
  await expect(page.getByTestId("flows-legacy-model-banner")).toHaveCount(0);

  // The backdrop is overlay-only -- docked it is `display: none` -- so close
  // through the header control, which works in both modes.
  await page.getByTestId("flows-inspector-close").click();
  // Docked, the aside stays mounted and falls back to its empty state rather
  // than unmounting, so assert on that instead of on the aside disappearing.
  await expect(page.getByTestId("flows-inspector-empty")).toBeVisible();
  await page.getByRole("button", { name: "Save" }).click();
  await expect
    .poll(() => {
      const agentNode = (currentFlow.draft_graph.nodes as FlowNode[]).find(
        (node): node is Extract<FlowNode, { type: "agent" }> =>
          node.id === "agent-a" && node.type === "agent"
      );
      return agentNode?.data.modelOverride;
    })
    .toBe("minimax/minimax-m2.5");
});

test("workflows model override selector flags a disabled current override as legacy", async ({
  page,
}) => {
  const pageErrors = capturePageErrors(page);
  await enableScopedE2EAuth(page);

  const disabledModelId = "anthropic/claude-sonnet-4.6";
  const enabledModelId = "minimax/minimax-m2.7";
  const currentFlow = {
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
      graph: {
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
              modelOverride: disabledModelId,
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
      },
      created_at: "2026-03-28T17:00:00.000Z",
    },
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
          data: {
            label: "Reviewer A",
            agentId: "agent-a",
            modelOverride: disabledModelId,
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
    },
  };

  await page.route("**/api/auth/user", (route) =>
    fulfillJson(route, { user: connectedUser })
  );
  await page.route("**/api/settings", (route) =>
    fulfillJson(route, { default_model: enabledModelId, theme: "dark" })
  );
  await page.route("**/api/models", (route) =>
    fulfillJson(route, {
      models: [
        {
          id: enabledModelId,
          provider: "minimax",
          name: "MiniMax M2.7",
          context_length: 1_000_000,
          capabilities: ["text"],
          is_available: true,
          is_hidden: false,
        },
      ],
      catalog: [
        {
          id: enabledModelId,
          provider: "minimax",
          name: "MiniMax M2.7",
          context_length: 1_000_000,
          capabilities: ["text"],
          is_available: true,
          is_hidden: false,
          is_enabled: true,
        },
        {
          id: disabledModelId,
          provider: "anthropic",
          name: "Claude Sonnet 4.6",
          context_length: 1_000_000,
          capabilities: ["text"],
          is_available: true,
          is_hidden: false,
          is_enabled: false,
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
        model: enabledModelId,
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
  await page.route("**/api/flows/flow-1", (route) =>
    fulfillJson(route, currentFlow)
  );
  await page.route("**/api/flows/flow-1/runs?limit=12", (route) =>
    fulfillJson(route, { runs: [] })
  );

  await page.goto(scopedPath("workflows"));
  await page.waitForLoadState("networkidle");

  const agentNode = page.getByTestId("rf__node-agent-a");
  await agentNode.click();
  await expect(page.locator(".flows-inspector")).toBeVisible();
  expect(pageErrors).toEqual([]);

  await expect(page.getByTestId("flows-legacy-model-warning")).toBeVisible();
  await expect(
    page.getByText("This node override is not enabled for this account.")
  ).toBeVisible();
  const modelSelect = page.getByLabel("Model", { exact: true });
  await expect(modelSelect).toHaveAttribute("data-value", disabledModelId);

  // A disabled current override is carried as a flagged legacy entry, not as a
  // normal choice: it is there once, marked, and it is not what the selector
  // offers for a fresh pick.
  await modelSelect.click();
  const disabledOption = page.locator(
    `[role="option"][data-value="${disabledModelId}"]`
  );
  await expect(disabledOption).toHaveCount(1);
  await expect(disabledOption).toHaveText(`Legacy · ${disabledModelId}`);

  const enabledOption = page.locator(
    `[role="option"][data-value="${enabledModelId}"]`
  );
  await expect(enabledOption).toHaveCount(1);
  await expect(enabledOption).not.toHaveText(/^Legacy · /);
});
