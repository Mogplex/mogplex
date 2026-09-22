import { mockSettingsShell } from "./helpers/billing-settings-fixtures";
import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  fulfillJson,
  setupWorkspaceRoutes,
} from "./helpers/connections-presets-fixtures";

test.beforeEach(async ({ page }) => {
  await mockSettingsShell(page);
});

for (const surface of ["settings", "workspace"] as const) {
  test(`${surface} quick-add saves and tests a Neon connection`, async ({
    page,
  }) => {
    const connections: Array<Record<string, unknown>> = [];
    let testRequests = 0;
    await enableScopedE2EAuth(page);
    await setupWorkspaceRoutes(page);
    await page.route("**/api/repos/repo-1/connections", (route) =>
      fulfillJson(route, { connections, overrides: [] })
    );
    await page.route("**/api/connections", async (route) => {
      if (route.request().method() === "GET") {
        await fulfillJson(route, { connections });
        return;
      }
      const body = route.request().postDataJSON();
      expect(body).toMatchObject({
        name: "Neon",
        type: "mcp_server",
        source_preset: "neon",
        mcp_transport: "http",
        mcp_url: "https://mcp.neon.tech/mcp",
        auth_type: "bearer",
        credentials: "neon_e2e_key",
      });
      const { credentials: _credentials, ...saved } = body;
      const connection = {
        ...saved,
        id: "conn-neon-new",
        user_id: "user-1",
        auth_header: "Authorization",
        is_enabled: true,
        health_status: "healthy",
        scope: "global",
        repo_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      connections.push(connection);
      await fulfillJson(route, { connection }, 201);
    });
    await page.route("**/api/connections/conn-neon-new/test", (route) => {
      testRequests += 1;
      return fulfillJson(route, { healthy: true, toolCount: 4 });
    });

    await page.goto(
      scopedPath(surface === "settings" ? "connections" : "projects/workspace")
    );
    if (surface === "workspace") {
      await page.getByTestId("home-open-workspace-repo-1").click();
      await page
        .locator('[data-pane-type="agent"]')
        .first()
        .getByTitle("Add pane")
        .click();
      await page.getByRole("menuitem", { name: "Connections" }).first().click();
    }
    const container =
      surface === "settings"
        ? page.getByTestId("settings-preset-neon")
        : page.locator('[data-pane-type="connections"]').last();
    const card =
      surface === "settings"
        ? container
        : container.getByTestId("connections-preset-neon");
    await expect(card).toBeVisible();
    await card
      .getByRole("button", {
        name: surface === "settings" ? "+ Add" : "+ Neon",
      })
      .click();
    const key = container.getByPlaceholder("Neon API key");
    await expect(key).toHaveAttribute("type", "password");
    await key.fill("neon_e2e_key");
    await container.getByRole("button", { name: "Add", exact: true }).click();
    await expect(card).toContainText("Connected · 4 tools");
    expect(testRequests).toBe(1);
    await expect(key).toHaveCount(0);
  });
}
