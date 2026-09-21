import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  connectedUser,
  modelId,
  fulfillJson,
} from "./helpers/connections-presets-fixtures";

test("settings lets the owner make a connection ask before its tools run, and switch it back", async ({
  page,
}) => {
  const connection: Record<string, unknown> = {
    id: "conn-trigger",
    user_id: "user-1",
    name: "Trigger.dev",
    type: "mcp_server",
    base_url: null,
    auth_type: "bearer",
    auth_header: "Authorization",
    mcp_transport: "stdio",
    mcp_url: null,
    description: "Tasks, runs, deploys, and Trigger.dev docs search",
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
    source_preset: "trigger",
    last_tested_at: new Date().toISOString(),
    last_test_error: null,
    last_test_http_status: 200,
    last_test_tool_count: 60,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const patches: Array<Record<string, unknown>> = [];

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
    if (route.request().method() !== "PATCH") {
      await fulfillJson(route, { connections: [connection] });
      return;
    }
    const body = route.request().postDataJSON() as Record<string, unknown>;
    patches.push(body);
    connection.approval_mode = body.approval_mode;
    await fulfillJson(route, { ok: true });
  });

  await page.goto(scopedPath("settings?tab=connections"));
  await page.waitForLoadState("networkidle");

  const row = page.locator('tr[data-connection-id="conn-trigger"]');
  await expect(row).toBeVisible();
  await expect(row.getByText("asks first")).toHaveCount(0);

  await row.getByRole("button", { name: "Connection actions" }).click();
  await page
    .getByRole("menuitem", { name: "Ask before running tools" })
    .click();

  await expect(row.getByText("asks first")).toBeVisible();
  expect(patches).toEqual([{ id: "conn-trigger", approval_mode: "ask" }]);

  await row.getByRole("button", { name: "Connection actions" }).click();
  await page
    .getByRole("menuitem", { name: "Run tools without asking" })
    .click();

  await expect(row.getByText("asks first")).toHaveCount(0);
  expect(patches[1]).toEqual({ id: "conn-trigger", approval_mode: "auto" });
});
