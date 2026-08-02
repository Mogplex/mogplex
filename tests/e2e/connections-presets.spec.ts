import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import { linkedVercelCapability } from "./helpers/activation-fixtures";
import type { Route } from "@playwright/test";

const connectedUser = {
  id: "user-1",
  email: "alex@example.com",
  username: "alex",
  name: "Alex",
  avatar_url: "https://example.com/avatar.png",
  github_connected: true,
  github_app_connected: false,
  github_app_available: false,
  github_connection_mode: "oauth" as const,
  vercel: linkedVercelCapability,
};

const modelId = "minimax/minimax-m2.5";

const repo = {
  id: "repo-1",
  full_name: "acme/demo-app",
  owner: "acme",
  name: "demo-app",
  default_branch: "main",
  is_hidden: false,
  is_favorite: false,
  dev_port: 3000,
  sandbox_timeout_ms: 600000,
};

async function fulfillJson(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(data),
  });
}

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

test("workspace connections pane auto-tests preset adds and labels preset-backed connections", async ({
  page,
}) => {
  const connections: Array<Record<string, unknown>> = [];

  await enableScopedE2EAuth(page);

  await page.route("**/__e2e/preview/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><html><body><main><h1>Demo Preview</h1></main></body></html>",
    });
  });

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
  await page.route("**/api/agents", (route) => fulfillJson(route, []));
  await page.route("**/api/assignments", (route) => fulfillJson(route, []));
  await page.route("**/api/commands", (route) => fulfillJson(route, []));
  await page.route(/\/api\/conversations(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "GET") {
      const url = new URL(route.request().url());
      const id = url.searchParams.get("id");
      await fulfillJson(
        route,
        id
          ? {
              id,
              messages: [],
              local_msgs: [],
              model: modelId,
              mode: "AUTO",
              title: null,
              updated_at: null,
            }
          : []
      );
      return;
    }

    await fulfillJson(route, { ok: true });
  });
  await page.route(/\/api\/repos(?:\?.*)?$/, (route) =>
    fulfillJson(route, [repo])
  );
  await page.route(/\/api\/sandbox$/, async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, {
        sandboxes: [
          {
            id: "sandbox-record-repo-1",
            repo_id: "repo-1",
            status: "running",
            created_at: new Date().toISOString(),
            preview_url: "http://127.0.0.1:3000/__e2e/preview/repo-1",
            health_status: "running",
          },
        ],
      });
      return;
    }

    await fulfillJson(route, {
      sandbox: {
        id: "sandbox-record-repo-1",
        repo_id: "repo-1",
        status: "running",
        created_at: new Date().toISOString(),
        preview_url: "http://127.0.0.1:3000/__e2e/preview/repo-1",
        health_status: "running",
      },
    });
  });
  await page.route(/\/api\/sandbox\/[^/]+\/health$/, (route) =>
    fulfillJson(route, {
      health: { status: "running" },
      sandbox: { health_status: "running" },
    })
  );
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
  // The add-pane menu lists each pane type twice (split right + "Split below");
  // take the first (horizontal split).
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

  await page.route("**/__e2e/preview/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><html><body><main><h1>Demo Preview</h1></main></body></html>",
    });
  });

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
  await page.route("**/api/agents", (route) => fulfillJson(route, []));
  await page.route("**/api/assignments", (route) => fulfillJson(route, []));
  await page.route("**/api/commands", (route) => fulfillJson(route, []));
  await page.route(/\/api\/conversations(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "GET") {
      const url = new URL(route.request().url());
      const id = url.searchParams.get("id");
      await fulfillJson(
        route,
        id
          ? {
              id,
              messages: [],
              local_msgs: [],
              model: modelId,
              mode: "AUTO",
              title: null,
              updated_at: null,
            }
          : []
      );
      return;
    }

    await fulfillJson(route, { ok: true });
  });
  await page.route(/\/api\/repos(?:\?.*)?$/, (route) =>
    fulfillJson(route, [repo])
  );
  await page.route(/\/api\/sandbox$/, async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, {
        sandboxes: [
          {
            id: "sandbox-record-repo-1",
            repo_id: "repo-1",
            status: "running",
            created_at: new Date().toISOString(),
            preview_url: "http://127.0.0.1:3000/__e2e/preview/repo-1",
            health_status: "running",
          },
        ],
      });
      return;
    }

    await fulfillJson(route, {
      sandbox: {
        id: "sandbox-record-repo-1",
        repo_id: "repo-1",
        status: "running",
        created_at: new Date().toISOString(),
        preview_url: "http://127.0.0.1:3000/__e2e/preview/repo-1",
        health_status: "running",
      },
    });
  });
  await page.route(/\/api\/sandbox\/[^/]+\/health$/, (route) =>
    fulfillJson(route, {
      health: { status: "running" },
      sandbox: { health_status: "running" },
    })
  );
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
  // The add-pane menu lists each pane type twice (split right + "Split below");
  // take the first (horizontal split).
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

  await page.route("**/__e2e/preview/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><html><body><main><h1>Demo Preview</h1></main></body></html>",
    });
  });
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
  await page.route("**/api/agents", (route) => fulfillJson(route, []));
  await page.route("**/api/assignments", (route) => fulfillJson(route, []));
  await page.route("**/api/commands", (route) => fulfillJson(route, []));
  await page.route(/\/api\/conversations(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "GET") {
      const url = new URL(route.request().url());
      const id = url.searchParams.get("id");
      await fulfillJson(
        route,
        id
          ? {
              id,
              messages: [],
              local_msgs: [],
              model: modelId,
              mode: "AUTO",
              title: null,
              updated_at: null,
            }
          : []
      );
      return;
    }

    await fulfillJson(route, { ok: true });
  });
  await page.route(/\/api\/repos(?:\?.*)?$/, (route) =>
    fulfillJson(route, [repo])
  );
  await page.route(/\/api\/sandbox$/, async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, {
        sandboxes: [
          {
            id: "sandbox-record-repo-1",
            repo_id: "repo-1",
            status: "running",
            created_at: new Date().toISOString(),
            preview_url: "http://127.0.0.1:3000/__e2e/preview/repo-1",
            health_status: "running",
          },
        ],
      });
      return;
    }

    await fulfillJson(route, {
      sandbox: {
        id: "sandbox-record-repo-1",
        repo_id: "repo-1",
        status: "running",
        created_at: new Date().toISOString(),
        preview_url: "http://127.0.0.1:3000/__e2e/preview/repo-1",
        health_status: "running",
      },
    });
  });
  await page.route(/\/api\/sandbox\/[^/]+\/health$/, (route) =>
    fulfillJson(route, {
      health: { status: "running" },
      sandbox: { health_status: "running" },
    })
  );
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
  // The add-pane menu lists each pane type twice (split right + "Split below");
  // take the first (horizontal split).
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
