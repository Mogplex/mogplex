import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  connectedUser,
  modelId,
  fulfillJson,
} from "./helpers/connections-presets-fixtures";

test("settings handles duplicate preset adds gracefully and shows preset origin badge", async ({
  page,
}) => {
  let connections: Array<Record<string, unknown>> = [];
  const existingConnection = {
    id: "conn-supabase-existing",
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

    if (route.request().method() === "POST") {
      connections = [existingConnection];
      await fulfillJson(
        route,
        {
          error: "Supabase is already connected from this preset",
          code: "PRESET_ALREADY_CONNECTED",
          connection: existingConnection,
        },
        409
      );
      return;
    }

    await fulfillJson(route, { ok: true });
  });

  await page.goto(scopedPath("settings?tab=connections"));
  await page.waitForLoadState("networkidle");

  await expect(page.getByTestId("settings-preset-manual-hint")).toContainText(
    "Need another advanced MCP? Use Add Connection instead."
  );
  await expect(page.getByTestId("settings-preset-notion")).toHaveCount(1);
  await expect(page.getByTestId("settings-preset-zapier")).toHaveCount(1);

  const presetCard = page.getByTestId("settings-preset-supabase");
  await presetCard.getByRole("button", { name: "+ Add" }).click();
  await presetCard.getByPlaceholder("sbp_...").fill("sbp_duplicate_token");
  await presetCard.getByRole("button", { name: "Add" }).click();

  await expect(presetCard).toContainText("Connected");
  await expect(presetCard).toContainText("already connected from this preset");
  await expect(page.getByText("preset · Supabase")).toBeVisible();
});

test("settings starts provider OAuth for hosted MCP presets instead of auto-testing them", async ({
  page,
}) => {
  const connections: Array<Record<string, unknown>> = [];
  let oauthStarts = 0;
  let oauthTests = 0;

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

    const created = {
      id: "conn-notion-new",
      user_id: "user-1",
      name: "Notion",
      type: "mcp_server",
      base_url: null,
      auth_type: "oauth",
      auth_header: "Authorization",
      mcp_transport: "http",
      mcp_url: "https://mcp.notion.com/mcp",
      description: "Workspace search, pages, databases, and comments",
      is_enabled: true,
      health_status: "unknown",
      scope: "global",
      repo_id: null,
      oauth_client_id: null,
      oauth_authorize_url: null,
      oauth_token_url: null,
      oauth_scopes: null,
      oauth_authorized_at: null,
      oauth_token_expires_at: null,
      source_preset: "notion",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    connections.splice(0, connections.length, created);
    await fulfillJson(route, { connection: created }, 201);
  });
  await page.route(
    "**/api/connections/oauth?connectionId=conn-notion-new",
    async (route) => {
      oauthStarts += 1;
      await route.fulfill({
        status: 302,
        headers: {
          location: scopedPath("settings?tab=connections&oauth=success"),
        },
        body: "",
      });
    }
  );
  await page.route("**/api/connections/conn-notion-new/test", async (route) => {
    oauthTests += 1;
    await fulfillJson(route, { healthy: false, error: "should not run" }, 500);
  });

  await page.goto(scopedPath("settings?tab=connections"));
  await page.waitForLoadState("networkidle");

  const presetCard = page.getByTestId("settings-preset-notion");
  await presetCard.getByRole("button", { name: "+ Add" }).click();
  await expect(presetCard).toContainText(
    "Connect through the provider OAuth flow"
  );
  await presetCard.getByRole("button", { name: "Connect" }).click();

  await page.waitForURL("**/settings?tab=connections&oauth=success");
  await expect(
    page.getByText("OAuth connection established. Run a test to verify tools.")
  ).toBeVisible();
  await expect(oauthStarts).toBe(1);
  await expect(oauthTests).toBe(0);
});

test("settings quick-add supports Zapier's secret full MCP URL", async ({
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
    expect(body.source_preset).toBe("zapier");
    expect(body.mcp_url).toBe("https://mcp.zapier.com/custom/server-secret");
    expect(body.credentials).toBeUndefined();

    const created = {
      id: "conn-zapier-new",
      user_id: "user-1",
      name: "Zapier",
      type: "mcp_server",
      base_url: null,
      auth_type: "none",
      auth_header: "Authorization",
      mcp_transport: "http",
      mcp_url: "https://mcp.zapier.com/custom/server-secret",
      description: "User-specific Zapier MCP server and tool actions",
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
      source_preset: "zapier",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    connections.splice(0, connections.length, created);
    await fulfillJson(route, { connection: created }, 201);
  });
  await page.route("**/api/connections/conn-zapier-new/test", async (route) => {
    await fulfillJson(route, { healthy: true, toolCount: 12 });
  });

  await page.goto(scopedPath("settings?tab=connections"));
  await page.waitForLoadState("networkidle");

  const presetCard = page.getByTestId("settings-preset-zapier");
  await presetCard.getByRole("button", { name: "+ Add" }).click();
  await expect(presetCard).toContainText(
    "Paste the full MCP server URL from Zapier's Connect tab"
  );
  await presetCard
    .getByPlaceholder("https://mcp.zapier.com/...")
    .fill("https://mcp.zapier.com/custom/server-secret");
  await presetCard.getByRole("button", { name: "Add" }).click();

  await expect(presetCard).toContainText("Connected · 12 tools");
  await expect(page.getByText("preset · Zapier")).toBeVisible();
});

test("settings manual add preserves input and surfaces API errors", async ({
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
  await page.route("**/api/connections", async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, { connections: [] });
      return;
    }

    await fulfillJson(
      route,
      { error: "Maximum 5 MCP connections allowed" },
      400
    );
  });

  await page.goto(scopedPath("settings?tab=connections"));
  await page.waitForLoadState("networkidle");

  const connectionTypeSelect = page
    .locator("select")
    .filter({ has: page.locator('option[value="mcp_server"]') })
    .last();
  await connectionTypeSelect.selectOption("mcp_server");
  await page.getByPlaceholder("name").fill("Browserbase MCP");
  await page
    .getByPlaceholder("https://mcp.example.com")
    .fill("https://mcp.browserbase.com/mcp");
  await page.getByPlaceholder("token").fill("bb_live_123");
  await page.getByRole("button", { name: "Add Connection" }).click();

  await expect(
    page.getByText("Maximum 5 MCP connections allowed")
  ).toBeVisible();
  await expect(page.getByPlaceholder("name")).toHaveValue("Browserbase MCP");
  await expect(page.getByPlaceholder("https://mcp.example.com")).toHaveValue(
    "https://mcp.browserbase.com/mcp"
  );
  await expect(page.getByPlaceholder("token")).toHaveValue("bb_live_123");
});

test("settings manual add surfaces network failures and keeps oauth hidden", async ({
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
  await page.route("**/api/connections", async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, { connections: [] });
      return;
    }

    await route.abort("failed");
  });

  await page.goto(scopedPath("settings?tab=connections"));
  await page.waitForLoadState("networkidle");

  const connectionTypeSelect = page
    .locator("select")
    .filter({ has: page.locator('option[value="mcp_server"]') })
    .last();
  await connectionTypeSelect.selectOption("mcp_server");

  const authSelect = page
    .locator("select")
    .filter({ has: page.locator('option[value="bearer"]') })
    .last();
  await expect(authSelect.locator('option[value="oauth"]')).toHaveCount(0);

  await page.getByPlaceholder("name").fill("Network Error MCP");
  await page
    .getByPlaceholder("https://mcp.example.com")
    .fill("https://example.com/mcp");
  await page.getByPlaceholder("token").fill("secret-token");
  await page.getByRole("button", { name: "Add Connection" }).click();

  await expect(
    page.getByText("Network error while adding connection")
  ).toBeVisible();
  await expect(page.getByPlaceholder("name")).toHaveValue("Network Error MCP");
  await expect(page.getByPlaceholder("https://mcp.example.com")).toHaveValue(
    "https://example.com/mcp"
  );
  await expect(page.getByPlaceholder("token")).toHaveValue("secret-token");
});

test("settings shows oauth reconnect and surfaces hard connection test failures", async ({
  page,
}) => {
  const oauthConnection = {
    id: "conn-oauth-reconnect",
    user_id: "user-1",
    name: "Linear OAuth",
    type: "mcp_server",
    base_url: null,
    auth_type: "oauth",
    auth_header: "Authorization",
    mcp_transport: "http",
    mcp_url: "https://mcp.linear.app/mcp",
    description: "OAuth-backed MCP",
    is_enabled: true,
    health_status: "auth_failed",
    scope: "global" as const,
    repo_id: null,
    oauth_client_id: "client-123",
    oauth_authorize_url: "https://linear.app/oauth/authorize",
    oauth_token_url: "https://api.linear.app/oauth/token",
    oauth_scopes: "read write",
    oauth_authorized_at: new Date(Date.now() - 120_000).toISOString(),
    oauth_token_expires_at: new Date(Date.now() - 60_000).toISOString(),
    source_preset: null,
    last_tested_at: new Date().toISOString(),
    last_test_error:
      "OAuth token expired and no refresh token available — re-authorize required",
    last_test_http_status: null,
    last_test_tool_count: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

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
      await fulfillJson(route, { connections: [oauthConnection] });
      return;
    }

    await fulfillJson(route, { ok: true });
  });
  await page.route(
    "**/api/connections/conn-oauth-reconnect/test",
    async (route) => {
      await fulfillJson(
        route,
        {
          error: "Connection test completed but the result could not be saved",
          code: "TEST_STATUS_PERSIST_FAILED",
        },
        500
      );
    }
  );

  await page.goto(scopedPath("settings?tab=connections"));
  await page.waitForLoadState("networkidle");

  await page.getByLabel("Connection actions").click();
  await expect(
    page.getByRole("menuitem", { name: "Reconnect OAuth" })
  ).toBeVisible();
  await page.getByRole("menuitem", { name: "Test Connection" }).click();

  await expect(
    page.getByText(
      "Connection test completed but the result could not be saved"
    )
  ).toBeVisible();
});
