import { buildSandboxFixture } from "./sandbox-fixtures";
import type { SandboxFixture } from "./sandbox-fixtures";
import type { Page } from "@playwright/test";
import type {
  MockUser,
  MockRepo,
  GithubSyncResponse,
} from "./activation-fixtures-types";
import { fulfillJson } from "./activation-fixtures-utils";
import { modelId, syncedRepo } from "./activation-fixtures-data";

export async function mockHomeState(
  page: Page,
  options: {
    user: MockUser;
    repos?: MockRepo[];
    reposError?: { status?: number; error: string };
    githubSyncResponse?: GithubSyncResponse;
  }
) {
  let repos = options.repos ?? [];

  await page.route("**/api/auth/user", (route) =>
    fulfillJson(route, { user: options.user })
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
  await page.route(/\/api\/repos(?:\?.*)?$/, (route) => {
    if (options.reposError) {
      return fulfillJson(
        route,
        { error: options.reposError.error },
        options.reposError.status ?? 500
      );
    }

    return fulfillJson(route, repos);
  });
  await page.route("**/api/github/repos", async (route) => {
    const { githubSyncResponse } = options;
    if (githubSyncResponse?.ok === false) {
      await fulfillJson(
        route,
        { error: githubSyncResponse.error },
        githubSyncResponse.status ?? 400
      );
      return;
    }

    repos = githubSyncResponse?.repos ?? [syncedRepo];
    await fulfillJson(route, repos);
  });
  await page.route(/\/api\/sandbox$/, async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, { sandboxes: [] });
      return;
    }

    if (route.request().method() === "POST") {
      const requestBody = route.request().postDataJSON() as { repoId: string };
      await fulfillJson(route, {
        sandbox: buildSandboxFixture({
          repoId: requestBody.repoId,
        }),
      });
      return;
    }

    await fulfillJson(route, {});
  });
}

export async function mockProjectsDashboard(
  page: Page,
  options: {
    user: MockUser;
    repos: MockRepo[];
    sandboxes: SandboxFixture[];
    reposError?: { status?: number; error: string };
    workspacesError?: { status?: number; error: string };
    workspaces?: Array<{
      id: string;
      user_id: string;
      name: string;
      description: string | null;
      is_default: boolean;
      sandbox_billing_mode: string;
      sandbox_vercel_team_id: string | null;
      sandbox_vercel_project_id: string | null;
      repo_count: number;
      created_at: string;
      updated_at: string;
    }>;
  }
) {
  const now = new Date().toISOString();
  const workspace = {
    id: "workspace-1",
    user_id: options.user.id,
    name: "Default",
    description: null,
    is_default: true,
    sandbox_billing_mode: "platform",
    sandbox_vercel_team_id: null,
    sandbox_vercel_project_id: null,
    repo_count: options.repos.length,
    created_at: now,
    updated_at: now,
  };
  const workspaces = options.workspaces ?? [workspace];

  await page.route("**/api/auth/user", (route) =>
    fulfillJson(route, { user: options.user })
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
  await page.route("**/api/workspaces", (route) => {
    if (options.workspacesError) {
      return fulfillJson(
        route,
        { error: options.workspacesError.error },
        options.workspacesError.status ?? 500
      );
    }
    return fulfillJson(route, workspaces);
  });
  await page.route(/\/api\/repos(?:\?.*)?$/, (route) => {
    if (options.reposError) {
      return fulfillJson(
        route,
        { error: options.reposError.error },
        options.reposError.status ?? 500
      );
    }
    return fulfillJson(route, options.repos);
  });
  await page.route("**/api/agents", (route) => fulfillJson(route, []));
  await page.route("**/api/assignments", (route) => fulfillJson(route, []));
  await page.route("**/api/github/repos", (route) =>
    fulfillJson(route, options.repos)
  );
  await page.route(/\/api\/sandbox$/, async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, { sandboxes: options.sandboxes });
      return;
    }

    await fulfillJson(route, {});
  });
}
