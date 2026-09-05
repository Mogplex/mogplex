import { linkedVercelCapability } from "./activation-fixtures";
import type { Page, Route } from "@playwright/test";

export const modelId = "minimax/minimax-m2.5";

export const connectedUser = {
  id: "user-1",
  email: "alex@example.com",
  username: "alex",
  name: "Alex",
  avatar_url: "https://example.com/avatar.png",
  github_connected: true,
  github_app_connected: true,
  github_app_available: true,
  github_connection_mode: "app" as const,
  vercel: linkedVercelCapability,
};

export async function fulfillJson(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(data),
  });
}

export async function mockBaseChrome(page: Page) {
  await page.route("**/api/realtime/events?*", (route) =>
    route.fulfill({ status: 204 })
  );
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
  await page.route("**/api/control/worktrees**", (route) =>
    fulfillJson(route, { worktrees: [] })
  );
}

export async function mockControlSessionBootstrap(page: Page) {
  await page.route("**/api/repos", (route) =>
    fulfillJson(route, [
      {
        id: "repo-control-default",
        full_name: "acme/widgets",
        owner: "acme",
        name: "widgets",
        default_branch: "main",
      },
    ])
  );
  let session: Record<string, unknown> | null = null;
  await page.route("**/api/control/sessions**", (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      const body = request.postDataJSON() as {
        title?: string;
        project?: string | null;
        repo_id?: string | null;
        model_id?: string | null;
      };
      session = {
        id: "session-control-default",
        title: body.title ?? "Control session",
        project: body.project ?? "acme/widgets",
        repo_id: body.repo_id ?? "repo-control-default",
        model_id: body.model_id ?? null,
        orchestration_run_id: "run-control-default",
        pinned: false,
        archived: false,
        messages: [],
        created_at: "2026-08-13T00:00:00.000Z",
        updated_at: "2026-08-13T00:00:00.000Z",
      };
      return fulfillJson(route, session);
    }
    if (request.method() === "PUT" && session) {
      const body = request.postDataJSON() as {
        messages?: unknown[];
        model_id?: string | null;
      };
      session = {
        ...session,
        messages: body.messages ?? session.messages,
        model_id: body.model_id ?? session.model_id,
        updated_at: "2026-08-13T00:00:01.000Z",
      };
      return fulfillJson(route, { ok: true, session });
    }
    const id = new URL(request.url()).searchParams.get("id");
    return fulfillJson(route, id ? session : session ? [session] : []);
  });
  await page.route("**/api/control/worktrees**", (route) =>
    fulfillJson(route, { worktrees: [] })
  );
  await page.route("**/api/sandbox", (route) =>
    fulfillJson(route, { sandboxes: [] })
  );
}
