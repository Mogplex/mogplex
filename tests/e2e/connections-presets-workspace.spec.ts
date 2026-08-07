import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  repo,
  fulfillJson,
  setupWorkspaceRoutes,
} from "./helpers/connections-presets-fixtures";

test("workspace connections pane auto-tests preset adds and labels preset-backed connections", async ({
  page,
}) => {
  const connections: Array<Record<string, unknown>> = [];

  await enableScopedE2EAuth(page);
  await setupWorkspaceRoutes(page);

  await page.route(/\/api\/repos\/repo-1\/connections$/, async (route) => {
    await fulfillJson(route, { connections, overrides: [] });
  });
  await page.route("**/api/connections", async (route) => {
    if (route.request().method() === "POST") {
      const created = {
        id: "conn-supabase-new",
        user_id: "user-1",
        name: "Supabase",
        type: "mcp_server",
        base_url: null,
        auth_type: "bearer",
        auth_header: null,
        mcp_transport: "http",
        mcp_url: "https://mcp.supabase.com/mcp",
        description: "Database, auth, storage, and edge functions",
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
        source_preset: "supabase",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      connections.splice(0, connections.length, created);
      await fulfillJson(route, { connection: created }, 201);
      return;
    }
    await fulfillJson(route, { connections });
  });
  await page.route(
    "**/api/connections/conn-supabase-new/test",
    async (route) => {
      await fulfillJson(route, { healthy: true, toolCount: 4 });
    }
  );

  await page.goto(scopedPath("projects/workspace"));
  await page.waitForLoadState("networkidle");
  await page.getByTestId("home-open-workspace-repo-1").click();

  const agentPane = page.locator('[data-pane-type="agent"]').first();
  await agentPane.getByTitle("Add pane").click();
  await page.getByRole("menuitem", { name: "Connections" }).first().click();

  const connectionsPane = page.locator('[data-pane-type="connections"]').last();
  await expect(
    connectionsPane.getByTestId("connections-preset-manual-hint")
  ).toContainText("Need another advanced MCP? Use Add Connection instead.");
  await expect(
    connectionsPane.getByTestId("connections-preset-notion")
  ).toHaveCount(1);
  await expect(
    connectionsPane.getByTestId("connections-preset-zapier")
  ).toHaveCount(1);

  const presetCard = connectionsPane.getByTestId("connections-preset-supabase");
  await presetCard.getByRole("button", { name: "+ Supabase" }).click();
  await connectionsPane.getByPlaceholder("sbp_...").fill("sbp_live_test");
  await connectionsPane
    .getByRole("button", { name: "Add", exact: true })
    .click();

  await expect(presetCard).toContainText("Connected · 4 tools");
  await expect(connectionsPane.getByText("preset · Supabase")).toBeVisible();
  await expect(presetCard.getByRole("button")).toHaveText(
    "Supabase · Connected"
  );
});

test("workspace connections pane can re-include excluded global connections", async ({
  page,
}) => {
  const globalConnection = {
    id: "conn-global-excluded",
    user_id: "user-1",
    name: "Supabase",
    type: "mcp_server",
    base_url: null,
    auth_type: "bearer",
    auth_header: "Authorization",
    mcp_transport: "http",
    mcp_url: "https://mcp.supabase.com/mcp",
    description: "Database, auth, storage, and edge functions",
    is_enabled: true,
    health_status: "healthy",
    scope: "global" as const,
    repo_id: null,
    oauth_client_id: null,
    oauth_authorize_url: null,
    oauth_token_url: null,
    oauth_scopes: null,
    oauth_authorized_at: null,
    oauth_token_expires_at: null,
    source_preset: "supabase",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  let overrides = [
    {
      id: "override-1",
      repo_id: repo.id,
      connection_id: globalConnection.id,
      excluded: true,
      created_at: new Date().toISOString(),
    },
  ];

  await enableScopedE2EAuth(page);
  await setupWorkspaceRoutes(page);

  await page.route(/\/api\/repos\/repo-1\/connections$/, async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as {
        connection_id: string;
        excluded: boolean;
      };
      overrides = [
        {
          ...overrides[0],
          connection_id: body.connection_id,
          excluded: body.excluded,
        },
      ];
      await fulfillJson(route, { ok: true });
      return;
    }
    await fulfillJson(route, {
      connections: [globalConnection],
      overrides,
      resolved_mcp_count: overrides[0]?.excluded ? 0 : 1,
    });
  });
  await page.route("**/api/connections", async (route) => {
    await fulfillJson(route, { connections: [globalConnection] });
  });

  await page.goto(scopedPath("projects/workspace"));
  await page.waitForLoadState("networkidle");
  await page.getByTestId("home-open-workspace-repo-1").click();

  const agentPane = page.locator('[data-pane-type="agent"]').first();
  await agentPane.getByTitle("Add pane").click();
  await page.getByRole("menuitem", { name: "Connections" }).first().click();

  const connectionsPane = page.locator('[data-pane-type="connections"]').last();
  const includeButton = connectionsPane.getByRole("button", {
    name: "excluded",
  });

  await expect(includeButton).toBeVisible();
  await includeButton.click();
  await expect(
    connectionsPane.getByRole("button", { name: "exclude" })
  ).toBeVisible();
});

test("workspace keeps disabled preset-backed rows visible and marks presets as configured", async ({
  page,
}) => {
  const globalConnection = {
    id: "conn-global-disabled",
    user_id: "user-1",
    name: "Supabase",
    type: "mcp_server",
    base_url: null,
    auth_type: "bearer",
    auth_header: "Authorization",
    mcp_transport: "http",
    mcp_url: "https://mcp.supabase.com/mcp",
    description: "Database, auth, storage, and edge functions",
    is_enabled: true,
    health_status: "healthy",
    scope: "global" as const,
    repo_id: null,
    oauth_client_id: null,
    oauth_authorize_url: null,
    oauth_token_url: null,
    oauth_scopes: null,
    oauth_authorized_at: null,
    oauth_token_expires_at: null,
    source_preset: "supabase",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  await enableScopedE2EAuth(page);
  await setupWorkspaceRoutes(page);

  await page.route(/\/api\/repos\/repo-1\/connections$/, async (route) => {
    await fulfillJson(route, {
      connections: [globalConnection],
      overrides: [],
      resolved_mcp_count: globalConnection.is_enabled ? 1 : 0,
    });
  });
  await page.route("**/api/connections", async (route) => {
    if (route.request().method() === "PATCH") {
      globalConnection.is_enabled = !globalConnection.is_enabled;
      await fulfillJson(route, { ok: true });
      return;
    }
    await fulfillJson(route, { connections: [globalConnection] });
  });

  await page.goto(scopedPath("projects/workspace"));
  await page.waitForLoadState("networkidle");
  await page.getByTestId("home-open-workspace-repo-1").click();

  const agentPane = page.locator('[data-pane-type="agent"]').first();
  await agentPane.getByTitle("Add pane").click();
  await page.getByRole("menuitem", { name: "Connections" }).first().click();

  const connectionsPane = page.locator('[data-pane-type="connections"]').last();
  const connectionRow = connectionsPane.locator(
    '[data-connection-id="conn-global-disabled"]'
  );
  const presetCard = connectionsPane.getByTestId("connections-preset-supabase");

  await connectionRow.getByRole("button").first().click();

  await expect(connectionRow).toContainText("disabled");
  await expect(connectionRow).toContainText("Supabase");
  await expect(presetCard.getByRole("button")).toHaveText(
    "Supabase · Configured"
  );
  await expect(presetCard).toContainText("Disabled");
  await presetCard.getByRole("button").click();
  await expect(connectionsPane.getByPlaceholder("sbp_...")).toHaveCount(0);

  await connectionRow.getByRole("button").first().click();
  await expect(connectionRow.getByText("disabled")).toHaveCount(0);
  await expect(presetCard.getByRole("button")).toHaveText(
    "Supabase · Connected"
  );
});
