import { linkedVercelCapability } from "./activation-fixtures";
import type { Page, Route } from "@playwright/test";

export const connectedUser = {
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

export const modelId = "minimax/minimax-m2.5";

export const repo = {
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

export async function fulfillJson(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(data),
  });
}

export async function setupWorkspaceRoutes(page: Page) {
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
}
