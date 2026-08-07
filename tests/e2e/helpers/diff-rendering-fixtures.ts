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

export const repo = {
  id: "repo-1",
  full_name: "acme/demo-app",
  owner: "acme",
  name: "demo-app",
  default_branch: "main",
  is_hidden: false,
  is_favorite: false,
};

export const modelId = "minimax/minimax-m2.5";

export function buildUiMessageStreamBody(text: string) {
  return [
    `data: ${JSON.stringify({ type: "text-start", id: "assistant-1" })}`,
    "",
    `data: ${JSON.stringify({ type: "text-delta", id: "assistant-1", delta: text })}`,
    "",
    `data: ${JSON.stringify({ type: "text-end", id: "assistant-1" })}`,
    "",
    "data: [DONE]",
    "",
  ].join("\n");
}

export function buildUiEventStreamBody(events: unknown[]) {
  return [
    ...events.flatMap((event) => [`data: ${JSON.stringify(event)}`, ""]),
    "data: [DONE]",
    "",
  ].join("\n");
}

export async function fulfillJson(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(data),
  });
}

export async function mockBaseApp(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
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
  await page.route("**/api/repos", (route) => fulfillJson(route, [repo]));
  await page.route("**/api/agents", (route) =>
    fulfillJson(route, { agents: [] })
  );
  await page.route("**/api/assignments", (route) => fulfillJson(route, []));
  await page.route("**/api/commands", (route) => fulfillJson(route, []));
  await page.route("**/api/observability/tool-calls", (route) =>
    fulfillJson(route, [])
  );
  await page.route("**/api/observability/calls?*", (route) =>
    fulfillJson(route, {
      calls: [],
      total: 0,
      page: 1,
      limit: 50,
    })
  );
  await page.route("**/api/observability/call-events?*", (route) =>
    fulfillJson(route, { events: [] })
  );
  await page.route(/\/api\/sandbox$/, async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, { sandboxes: [] });
      return;
    }

    if (route.request().method() === "POST") {
      await fulfillJson(route, {
        sandbox: {
          id: "sandbox-record-1",
          repo_id: repo.id,
          status: "running",
          created_at: new Date().toISOString(),
          preview_url: "http://localhost:3100/__e2e/preview/repo-1",
          health_status: "running",
        },
      });
      return;
    }

    await fulfillJson(route, {});
  });
}
