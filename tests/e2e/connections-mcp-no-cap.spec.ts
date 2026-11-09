import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  mockBaseChrome,
  mockControlSessionBootstrap,
} from "./helpers/automation-control-plane-fixtures";
import {
  fulfillJson,
  setupWorkspaceRoutes,
} from "./helpers/connections-presets-fixtures";
import type { Page } from "@playwright/test";

// More than the five servers the removed cap allowed.
const EXISTING_MCP_COUNT = 7;
const CAP_COPY = /at cap|max \d|reached/i;
// Server names render beside a scope badge, so they match as substrings.

function mcpConnection(index: number, name = `Fixture MCP ${index}`) {
  return {
    id: `conn-mcp-${index}`,
    user_id: "user-1",
    name,
    type: "mcp_server",
    base_url: null,
    auth_type: "none",
    auth_header: null,
    mcp_transport: "http",
    mcp_url: `https://mcp-${index}.example.com/mcp`,
    description: null,
    is_enabled: true,
    approval_mode: "auto",
    health_status: "healthy",
    scope: "global",
    repo_id: null,
    oauth_client_id: null,
    oauth_authorize_url: null,
    oauth_token_url: null,
    oauth_scopes: null,
    oauth_authorized_at: null,
    oauth_token_expires_at: null,
    source_preset: null,
    created_at: "2026-11-09T00:00:00.000Z",
    updated_at: "2026-11-09T00:00:00.000Z",
  };
}

const existingNames = Array.from(
  { length: EXISTING_MCP_COUNT },
  (_, index) => `Fixture MCP ${index + 1}`
);

/**
 * Serves one in-memory list of MCP connections from every connections read
 * and appends whatever the UI creates.
 */
async function mockManyMcpConnections(page: Page) {
  const connections = existingNames.map((name, index) =>
    mcpConnection(index + 1, name)
  );
  const created: Array<Record<string, unknown>> = [];
  const resolved = () => ({
    connections,
    overrides: [],
    resolved_mcp_count: connections.length,
  });
  await page.route(/\/api\/repos\/repo-1\/connections$/, (route) =>
    fulfillJson(route, resolved())
  );
  await page.route("**/api/connections", async (route) => {
    if (route.request().method() !== "POST") {
      await fulfillJson(route, { connections });
      return;
    }
    const body = route.request().postDataJSON() as Record<string, unknown>;
    created.push(body);
    const connection = {
      ...mcpConnection(connections.length + 1, String(body.name)),
      scope: body.scope === "project" ? "project" : "global",
    };
    connections.push(connection);
    await fulfillJson(route, { connection }, 201);
  });
  return { created };
}

/** Opens the repo-1 workspace and returns its first agent pane. */
async function openWorkspace(page: Page) {
  await enableScopedE2EAuth(page);
  await setupWorkspaceRoutes(page);
  const mocks = await mockManyMcpConnections(page);
  await page.goto(scopedPath("projects/workspace"));
  await page.waitForLoadState("networkidle");
  await page.getByTestId("home-open-workspace-repo-1").click();
  return {
    ...mocks,
    agentPane: page.locator('[data-pane-type="agent"]').first(),
  };
}

test("should list every MCP server and keep adding open past five in the workspace chat menu", async ({
  page,
}) => {
  const { created, agentPane } = await openWorkspace(page);

  await agentPane.getByTitle("MCP tools status").click();
  const menu = page.getByRole("dialog", { name: "MCP servers" });
  for (const name of existingNames) {
    await expect(menu.getByText(name)).toBeVisible();
  }
  await expect(menu.getByText(CAP_COPY)).toHaveCount(0);
  const addFromMenu = menu.getByRole("button", {
    name: "+ Add MCP server",
    exact: true,
  });
  await expect(addFromMenu).toBeEnabled();
  await addFromMenu.click();
  await expect(menu.getByText(CAP_COPY)).toHaveCount(0);
  await menu.getByPlaceholder("Name (e.g. Supabase)").fill("Menu MCP");
  await menu
    .getByPlaceholder("https://mcp.example.com/sse")
    .fill("https://menu.example.com/mcp");
  await menu.getByRole("button", { name: "Add", exact: true }).click();
  await expect(menu.getByText("Menu MCP")).toBeVisible();

  expect(created).toEqual([
    expect.objectContaining({ type: "mcp_server", name: "Menu MCP" }),
  ]);
});

test("should list every MCP server and keep adding open past five in the workspace connections pane", async ({
  page,
}) => {
  const { created, agentPane } = await openWorkspace(page);

  await agentPane.getByTitle("Add pane").click();
  await page.getByRole("menuitem", { name: "Connections" }).first().click();
  const pane = page.locator('[data-pane-type="connections"]').last();
  await expect(
    pane.getByText(`${EXISTING_MCP_COUNT} MCPs`, { exact: true })
  ).toBeVisible();
  // A narrow pane can squeeze the name column to zero width, so rows are
  // matched by their text rather than by the name's visibility.
  const rows = pane.locator("[data-connection-id]");
  await expect(rows).toHaveCount(EXISTING_MCP_COUNT);
  for (const name of existingNames) {
    await expect(rows.filter({ hasText: name })).toHaveCount(1);
  }
  await expect(pane.getByText(CAP_COPY)).toHaveCount(0);
  await pane.getByRole("button", { name: "Add connection" }).click();
  const mcpType = pane.getByRole("button", { name: "MCP Server", exact: true });
  await expect(mcpType).toBeEnabled();
  await mcpType.click();
  await pane.getByPlaceholder("Connection name").fill("Pane MCP");
  await pane
    .getByPlaceholder("MCP Server URL")
    .fill("https://pane.example.com/mcp");
  await pane.getByRole("button", { name: "Create" }).click();
  await expect(
    pane.getByText(`${EXISTING_MCP_COUNT + 1} MCPs`, { exact: true })
  ).toBeVisible();
  await expect(rows).toHaveCount(EXISTING_MCP_COUNT + 1);
  await expect(rows.filter({ hasText: "Pane MCP" })).toHaveCount(1);

  expect(created).toEqual([
    expect.objectContaining({ type: "mcp_server", name: "Pane MCP" }),
  ]);
});

test("should list every global MCP server and keep adding open past five in the Control composer", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockBaseChrome(page);
  await mockControlSessionBootstrap(page);
  const { created } = await mockManyMcpConnections(page);
  await page.route("**/api/control/chat", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers: { "x-vercel-ai-ui-message-stream": "v1" },
      body: 'data: {"type":"start","messageId":"fixture-answer"}\n\ndata: {"type":"finish"}\n\ndata: [DONE]\n\n',
    })
  );

  await page.goto(scopedPath("/control"));
  await page
    .getByPlaceholder("Ask anything or run a command...")
    .fill("List the MCP servers");
  await page.getByRole("button", { name: "Start mission" }).click();
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();

  await page.getByTitle("MCP tools status").click();
  const menu = page.getByRole("dialog", { name: "MCP servers" });
  for (const name of existingNames) {
    await expect(menu.getByText(name)).toBeVisible();
  }
  await expect(menu.getByText(CAP_COPY)).toHaveCount(0);
  const addFromMenu = menu.getByRole("button", {
    name: "+ Add MCP server",
    exact: true,
  });
  await expect(addFromMenu).toBeEnabled();
  await addFromMenu.click();
  await expect(menu.getByText(CAP_COPY)).toHaveCount(0);
  await menu.getByPlaceholder("Name (e.g. Supabase)").fill("Control MCP");
  await menu
    .getByPlaceholder("https://mcp.example.com/sse")
    .fill("https://control.example.com/mcp");
  await menu.getByRole("button", { name: "Add", exact: true }).click();
  await expect(menu.getByText("Control MCP")).toBeVisible();

  expect(created).toEqual([
    expect.objectContaining({
      type: "mcp_server",
      name: "Control MCP",
      scope: "global",
    }),
  ]);
});
