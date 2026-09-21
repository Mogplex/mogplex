import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  connectedUser,
  modelId,
  fulfillJson,
} from "./helpers/connections-presets-fixtures";

test("settings quick-add saves the Trigger.dev stdio preset with a personal access token", async ({
  page,
}) => {
  const connections: Array<Record<string, unknown>> = [];

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

    const body = route.request().postDataJSON() as Record<string, string>;
    expect(body.source_preset).toBe("trigger");
    expect(body.mcp_transport).toBe("stdio");
    expect(body.mcp_url).toBeUndefined();
    expect(body.credentials).toBe("tr_pat_e2e_token");

    const created = {
      id: "conn-trigger-new",
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
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    connections.splice(0, connections.length, created);
    await fulfillJson(route, { connection: created }, 201);
  });
  await page.route("**/api/connections/conn-trigger-new/test", (route) =>
    fulfillJson(route, { healthy: true, summary: "Credential verified" })
  );

  await page.goto(scopedPath("settings?tab=connections"));
  await page.waitForLoadState("networkidle");

  const presetCard = page.getByTestId("settings-preset-trigger");
  await presetCard.getByRole("button", { name: "+ Add" }).click();
  await expect(presetCard).toContainText(
    "Runs inside your sandboxes and the Mogplex CLI"
  );
  await presetCard.getByPlaceholder("tr_pat_...").fill("tr_pat_e2e_token");
  await presetCard.getByRole("button", { name: "Add" }).click();

  await expect(presetCard).toContainText("Connected");
  await expect(page.getByText("preset · Trigger.dev")).toBeVisible();
});
