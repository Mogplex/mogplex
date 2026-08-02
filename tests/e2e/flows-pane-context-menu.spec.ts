import { expect, test } from "@playwright/test";
import {
  E2E_SCOPE_USER,
  enableScopedE2EAuth,
  scopedPath,
} from "./helpers/auth";
import { linkedVercelCapability } from "./helpers/activation-fixtures";
import { selectAppOption } from "./helpers/app-select";
import type { Page, Route } from "@playwright/test";

const connectedUser = {
  id: E2E_SCOPE_USER.id,
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

async function stubFlowsPage(page: Page) {
  await enableScopedE2EAuth(page);
  await page.addInitScript(() => {
    window.localStorage.setItem("theme", "dark");
  });

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
        {
          id: "openai/gpt-5.4",
          provider: "openai",
          name: "GPT-5.4",
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
        {
          id: "openai/gpt-5.4",
          provider: "openai",
          name: "GPT-5.4",
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
      {
        id: "agent-b",
        name: "Reviewer B",
        slug: "reviewer-b",
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
      graph: {},
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
          data: { label: "Reviewer A", agentId: "agent-a" },
        },
        {
          id: "agent-b",
          type: "agent",
          position: { x: 640, y: 160 },
          data: { label: "Reviewer B", agentId: "agent-b" },
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
        { id: "edge-2", source: "agent-a", target: "agent-b" },
        { id: "edge-3", source: "agent-b", target: "end" },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  };
  currentFlow.published_version.graph = structuredClone(
    currentFlow.draft_graph
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
    > & { draft_graph?: typeof currentFlow.draft_graph };
    currentFlow = {
      ...currentFlow,
      ...payload,
      draft_graph: payload.draft_graph ?? currentFlow.draft_graph,
    };
    await fulfillJson(route, currentFlow);
  });
}

test("canvas context menu adds and configures workflow nodes, then closes on escape", async ({
  page,
}) => {
  await stubFlowsPage(page);

  await page.goto(scopedPath("workflows"));
  await page.waitForLoadState("networkidle");

  const pane = page.locator(".react-flow__pane");
  await pane.dispatchEvent("contextmenu", {
    clientX: 540,
    clientY: 180,
    button: 2,
    bubbles: true,
    cancelable: true,
  });

  const menu = page.getByTestId("flow-context-menu");
  await expect(menu).toBeVisible();
  await page.getByTestId("flow-context-add-agent").click();
  await expect(page.locator(".react-flow__node")).toHaveCount(5);
  await expect(menu).toBeHidden();

  // Click on canvas to deselect before opening next context menu
  await pane.click({ position: { x: 50, y: 50 } });
  await pane.dispatchEvent("contextmenu", {
    clientX: 900,
    clientY: 120,
    button: 2,
    bubbles: true,
    cancelable: true,
  });
  await expect(menu).toBeVisible();
  await page.getByTestId("flow-context-add-condition").click();
  await expect(page.locator(".react-flow__node")).toHaveCount(6);

  // Click on canvas to deselect before opening next context menu
  await pane.click({ position: { x: 50, y: 50 } });
  await pane.dispatchEvent("contextmenu", {
    clientX: 980,
    clientY: 160,
    button: 2,
    bubbles: true,
    cancelable: true,
  });
  await expect(menu).toBeVisible();
  await page.getByTestId("flow-context-add-transform").click();
  await expect(page.locator(".react-flow__node")).toHaveCount(7);
  await expect(
    page.getByText("Transform operator", { exact: true })
  ).toBeVisible();
  await page.getByTestId("flow-transform-key-0").fill("tests_changed");
  await selectAppOption(
    page.getByTestId("flow-transform-operation-0"),
    "files_match_glob"
  );
  await page.getByTestId("flow-transform-argument-0").fill("**/*.test.ts");
  await expect(page.getByTestId("flow-transform-source-0")).toHaveValue(
    "metadata.changed_files"
  );

  await pane.dispatchEvent("contextmenu", {
    clientX: 1040,
    clientY: 200,
    button: 2,
    bubbles: true,
    cancelable: true,
  });
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
});

test("agent node context menu duplicates and deletes nodes", async ({
  page,
}) => {
  await stubFlowsPage(page);

  await page.goto(scopedPath("workflows"));
  await page.waitForLoadState("networkidle");

  const agentNode = page
    .locator(".react-flow__node")
    .filter({ hasText: "Reviewer B" })
    .first();
  await agentNode.dispatchEvent("contextmenu", {
    clientX: 760,
    clientY: 180,
    button: 2,
    bubbles: true,
    cancelable: true,
  });
  await expect(page.getByTestId("flow-context-node-duplicate")).toBeVisible();
  // Force click to bypass stability checks - the menu re-renders during selection
  await page.getByTestId("flow-context-node-duplicate").click({ force: true });
  await expect(page.locator(".react-flow__node")).toHaveCount(5);

  // Wait for the duplicated node to be selected and stable
  const selectedNode = page.locator(".react-flow__node.selected").first();
  await expect(selectedNode).toBeVisible();
  await selectedNode.dispatchEvent("contextmenu", {
    clientX: 820,
    clientY: 230,
    button: 2,
    bubbles: true,
    cancelable: true,
  });
  await expect(page.getByTestId("flow-context-node-delete")).toBeVisible();
  await page.getByTestId("flow-context-node-delete").click({ force: true });
  await expect(page.locator(".react-flow__node")).toHaveCount(4);
});

test("an open node context menu owns destructive canvas shortcuts", async ({
  page,
}) => {
  await stubFlowsPage(page);

  await page.goto(scopedPath("workflows"));
  await page.waitForLoadState("networkidle");

  const agentNode = page
    .locator(".react-flow__node")
    .filter({ hasText: "Reviewer B" })
    .first();
  await agentNode.dispatchEvent("contextmenu", {
    clientX: 760,
    clientY: 180,
    button: 2,
    bubbles: true,
    cancelable: true,
  });

  const menu = page.getByTestId("flow-context-menu");
  await expect(menu).toBeVisible();
  await expect(agentNode).toHaveClass(/selected/);
  // Backspace closes the menu but blocks the delete action (menu "owns" the shortcut)
  await page.keyboard.press("Backspace");
  await expect(menu).toBeHidden();
  // Node must NOT be deleted - the context menu blocked the destructive action
  await expect(
    page.locator('.react-flow__node[data-id="agent-b"]')
  ).toHaveCount(1);
  await expect(page.locator(".react-flow__node")).toHaveCount(4);
});

test("edge insertion menu can insert an agent into an existing path", async ({
  page,
}) => {
  await stubFlowsPage(page);

  await page.goto(scopedPath("workflows"));
  await page.waitForLoadState("networkidle");

  const insertButton = page.getByTestId("flow-edge-insert-edge-2");
  await expect(insertButton).toBeVisible();
  await insertButton.click();

  const menu = page.getByTestId("flow-context-menu");
  await expect(menu).toBeVisible();
  await menu.getByTestId("flow-context-edge-add-agent").click();

  await expect(page.locator(".react-flow__node")).toHaveCount(5);
  await expect(
    page.locator(".react-flow__node").filter({ hasText: "Reviewer A" })
  ).toHaveCount(2);
});

test("structural nodes do not expose destructive context actions", async ({
  page,
}) => {
  await stubFlowsPage(page);

  await page.goto(scopedPath("workflows"));
  await page.waitForLoadState("networkidle");

  await page
    .locator(".react-flow__node")
    .filter({ hasText: "PR opened" })
    .click({ button: "right" });
  const menu = page.getByTestId("flow-context-menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByTestId("flow-context-node-duplicate")).toHaveCount(0);
  await expect(menu.getByTestId("flow-context-node-delete")).toHaveCount(0);
  await expect(
    menu.getByTestId("flow-context-node-clear-selection")
  ).toBeVisible();
});
