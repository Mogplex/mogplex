import { mockSettingsShell } from "./helpers/billing-settings-fixtures";
import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  connectedUser,
  modelId,
  fulfillJson,
} from "./helpers/connections-presets-fixtures";

test.beforeEach(async ({ page }) => {
  await mockSettingsShell(page);
});

test("should start browser sign-in for a custom MCP server added with OAuth", async ({
  page,
}) => {
  const connections: Array<Record<string, unknown>> = [];
  const created: Array<Record<string, unknown>> = [];
  let oauthStarts = 0;

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
  await page.route("**/api/connections", async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, { connections });
      return;
    }
    const body = route.request().postDataJSON() as Record<string, unknown>;
    created.push(body);
    const connection = {
      ...body,
      id: "conn-custom-oauth",
      user_id: "user-1",
      is_enabled: true,
      health_status: "unknown",
      scope: "global",
      repo_id: null,
      source_preset: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    connections.splice(0, connections.length, connection);
    await fulfillJson(route, { connection }, 201);
  });
  await page.route(
    "**/api/connections/oauth?connectionId=conn-custom-oauth",
    async (route) => {
      oauthStarts += 1;
      await route.fulfill({
        status: 302,
        headers: { location: scopedPath("connections?oauth=success") },
        body: "",
      });
    }
  );

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
  await page
    .locator("select")
    .filter({ hasText: "OAuth (browser sign-in)" })
    .selectOption("oauth");
  await expect(page.getByPlaceholder("token")).toHaveCount(0);
  await page.getByRole("button", { name: "Add and sign in" }).click();

  await page.waitForURL("**/connections?oauth=success");
  expect(oauthStarts).toBe(1);
  expect(created).toHaveLength(1);
  expect(created[0]).toMatchObject({
    type: "mcp_server",
    auth_type: "oauth",
    mcp_url: "https://mcp.artifacts.example/mcp",
    credentials: "",
  });
});
