import { mockSettingsShell } from "./helpers/billing-settings-fixtures";
import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  connectedUser,
  modelId,
  fulfillJson,
  setupWorkspaceRoutes,
} from "./helpers/connections-presets-fixtures";
import type { Page } from "@playwright/test";

const STALE_TOKEN = "stale-bearer-token";

/** Mocks connection creation and the OAuth start for a custom MCP server. */
async function mockCustomOAuthCreate(page: Page) {
  const created: Array<Record<string, unknown>> = [];
  const oauthStarts: string[] = [];
  await page.route("**/api/connections", async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, { connections: [] });
      return;
    }
    const body = route.request().postDataJSON() as Record<string, unknown>;
    created.push(body);
    await fulfillJson(
      route,
      { connection: { ...body, id: "conn-custom-oauth", is_enabled: true } },
      201
    );
  });
  await page.route(
    "**/api/connections/oauth?connectionId=conn-custom-oauth",
    async (route) => {
      oauthStarts.push(route.request().url());
      await route.fulfill({
        status: 302,
        headers: { location: scopedPath("connections?oauth=success") },
        body: "",
      });
    }
  );
  return { created, oauthStarts };
}

test.beforeEach(async ({ page }) => {
  await mockSettingsShell(page);
});

test("should start browser sign-in without a stale credential when a custom MCP server switches to OAuth", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await page.route("**/api/auth/user", (route) =>
    fulfillJson(route, { user: connectedUser })
  );
  await page.route("**/api/settings", (route) =>
    fulfillJson(route, { default_model: modelId, theme: "dark" })
  );
  await page.route("**/api/models", (route) =>
    fulfillJson(route, {
      models: [{ id: modelId, context_length: 128000 }],
      catalog: [{ id: modelId, context_length: 128000, is_enabled: true }],
    })
  );
  const { created, oauthStarts } = await mockCustomOAuthCreate(page);

  await page.goto(scopedPath("connections"));
  await page.waitForLoadState("networkidle");

  await page
    .locator("select")
    .filter({ hasText: "MCP Server" })
    .selectOption("mcp_server");
  await page.getByPlaceholder("name", { exact: true }).fill("Artifacts");
  await page
    .getByPlaceholder("https://mcp.example.com")
    .fill("https://mcp.artifacts.example/mcp");
  // A token typed for Bearer auth must not follow the user into OAuth.
  await page.getByPlaceholder("token", { exact: true }).fill(STALE_TOKEN);
  await page
    .locator("select")
    .filter({ hasText: "OAuth (browser sign-in)" })
    .selectOption("oauth");
  await expect(page.getByPlaceholder("token", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Add and sign in" }).click();

  await page.waitForURL("**/connections?oauth=success");
  expect(oauthStarts).toHaveLength(1);
  expect(created).toHaveLength(1);
  expect(created[0]).toMatchObject({
    type: "mcp_server",
    auth_type: "oauth",
    mcp_url: "https://mcp.artifacts.example/mcp",
  });
  expect(created[0]).not.toHaveProperty("credentials");
  expect(JSON.stringify(created[0])).not.toContain(STALE_TOKEN);
});

test("should start browser sign-in from the workspace pane without sending a stale credential", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await setupWorkspaceRoutes(page);
  await page.route(/\/api\/repos\/repo-1\/connections$/, (route) =>
    fulfillJson(route, { connections: [], overrides: [] })
  );
  const { created, oauthStarts } = await mockCustomOAuthCreate(page);

  await page.goto(scopedPath("projects/workspace"));
  await page.waitForLoadState("networkidle");
  await page.getByTestId("home-open-workspace-repo-1").click();
  await page
    .locator('[data-pane-type="agent"]')
    .first()
    .getByTitle("Add pane")
    .click();
  await page.getByRole("menuitem", { name: "Connections" }).first().click();

  const pane = page.locator('[data-pane-type="connections"]').last();
  await pane.getByRole("button", { name: "Add connection" }).click();
  await pane.getByRole("button", { name: "MCP Server" }).click();
  await pane.getByPlaceholder("Connection name").fill("Artifacts");
  await pane
    .getByPlaceholder("MCP Server URL")
    .fill("https://mcp.artifacts.example/mcp");
  const authSelect = pane.locator("select").filter({ hasText: "Bearer Token" });
  await authSelect.selectOption("bearer");
  await pane.getByPlaceholder("Token", { exact: true }).fill(STALE_TOKEN);
  await authSelect.selectOption("oauth");
  await expect(pane.getByPlaceholder("Client Secret (optional)")).toHaveValue(
    ""
  );
  await pane.getByRole("button", { name: "Create" }).click();

  await page.waitForURL("**/connections?oauth=success");
  expect(oauthStarts).toHaveLength(1);
  expect(created).toHaveLength(1);
  expect(created[0]).toMatchObject({
    type: "mcp_server",
    auth_type: "oauth",
    mcp_url: "https://mcp.artifacts.example/mcp",
  });
  expect(created[0]).not.toHaveProperty("credentials");
  expect(JSON.stringify(created[0])).not.toContain(STALE_TOKEN);
});
