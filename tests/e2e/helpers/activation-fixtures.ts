import {
  buildObservabilitySummary,
  buildSandboxFixture,
  buildSandboxSummaries,
} from "./sandbox-fixtures";
import type {
  ObservabilityCallFixture,
  SandboxBillingSummary,
  SandboxFixture,
} from "./sandbox-fixtures";
import type { Page, Route } from "@playwright/test";
import type { GithubPrimaryAction, GithubState } from "@/lib/github-state";
import type { VercelCapability } from "@/lib/vercel/capabilities";
import type { SandboxVercelDiagnostics } from "@/lib/vercel/sandbox-diagnostics";

export type TrackedEvent = {
  name: string;
  properties?: Record<string, string | number | boolean | null | undefined>;
};

export type MockUser = {
  id: string;
  email: string;
  username: string;
  name: string;
  avatar_url: string;
  github_connected: boolean;
  github_app_connected: boolean;
  github_app_available: boolean;
  github_connection_mode: "oauth" | "app" | null;
  github_state?: GithubState;
  github_status_label?: string;
  github_status_detail?: string;
  github_primary_action?: GithubPrimaryAction;
  github_install_pending?: boolean;
  github_installation_count?: number;
  github_synced_repo_count?: number;
  vercel: VercelCapability;
};

export type MockRepo = {
  id: string;
  full_name: string;
  owner: string;
  name: string;
  default_branch: string;
  is_hidden: boolean;
  is_favorite: boolean;
  dev_port: number;
  sandbox_timeout_ms: number;
};

type GithubSyncResponse =
  | { ok?: true; repos?: MockRepo[] }
  | { ok: false; status?: number; error: string };

const modelId = "minimax/minimax-m2.5";

export const linkedVercelCapability: VercelCapability = {
  platformState: "ready",
  personalState: "linked",
  linkedProjectState: "none",
  canUsePlatformOps: true,
  canLinkUserBillingProject: true,
  canUseUserBilling: false,
  statusLabel: "Platform ready",
  statusDetail:
    "Mogplex platform Vercel is ready. Personal Vercel is linked, but no billing project is selected yet.",
};

export const connectedUser: MockUser = {
  id: "user-1",
  email: "alex@example.com",
  username: "alex",
  name: "Alex",
  avatar_url: "https://example.com/avatar.png",
  github_connected: true,
  github_app_connected: false,
  github_app_available: false,
  github_connection_mode: "oauth",
  github_state: "oauth_connected",
  github_status_label: "GitHub connected",
  github_status_detail:
    "GitHub is connected. Spaces can sync now, and the GitHub App can be installed later for trigger coverage.",
  github_primary_action: null,
  github_install_pending: false,
  github_installation_count: 0,
  github_synced_repo_count: 0,
  vercel: linkedVercelCapability,
};

export const disconnectedGithubUser: MockUser = {
  ...connectedUser,
  github_connected: false,
  github_connection_mode: null,
  github_state: "disconnected",
  github_status_label: "Connect GitHub",
  github_status_detail:
    "Connect GitHub to import spaces and launch workspaces.",
  github_primary_action: {
    kind: "connect",
    label: "Connect GitHub",
    href: "/api/auth/github",
  },
};

export const syncedRepo: MockRepo = {
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

export const secondaryRepo: MockRepo = {
  ...syncedRepo,
  id: "repo-2",
  full_name: "acme/docs-app",
  name: "docs-app",
};

export async function fulfillJson(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(data),
  });
}

// Matches AutomationFailuresResponse for specs that visit /observability but
// don't exercise the Automation Failures section.
export const emptyAutomationFailuresResponse = {
  records: [],
  total: 0,
  page: 1,
  limit: 25,
  summary: {
    failedTotal: 0,
    successfulRecoveries: 0,
    retriedFailures: 0,
    timeoutFailures: 0,
    authenticationFailures: 0,
    configurationFailures: 0,
    providerFailures: 0,
    dependencyFailures: 0,
  },
  breakdowns: {
    byFailureClass: [],
    bySourceType: [],
    byProvider: [],
    byModel: [],
    byTimeoutBucket: [],
  },
  filter_options: {
    failureClasses: [],
    sourceTypes: [],
    providers: [],
    models: [],
  },
};

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

export async function initializeTrackedEvents(page: Page) {
  await page.addInitScript(() => {
    window.__mogplexTrackedEvents = [];
    const bootstrapKey = "mogplex-e2e-bootstrap-done";
    if (!window.sessionStorage.getItem(bootstrapKey)) {
      window.localStorage.clear();
      window.sessionStorage.clear();
      window.sessionStorage.setItem(bootstrapKey, "1");
    }
  });
}

export async function getTrackedEvents(page: Page): Promise<TrackedEvent[]> {
  return page.evaluate(() => {
    const events = window.__mogplexTrackedEvents;
    if (Array.isArray(events) && events.length > 0) {
      return events;
    }

    try {
      return JSON.parse(
        window.sessionStorage.getItem("mogplex-tracked-events") || "[]"
      ) as TrackedEvent[];
    } catch {
      return [];
    }
  });
}

export async function waitForTrackedEvent(
  page: Page,
  name: TrackedEvent["name"]
) {
  await page.waitForFunction(
    (eventName) =>
      (window.__mogplexTrackedEvents ?? []).some(
        (event) => event.name === eventName
      ),
    name
  );
}

export async function mockSettingsPage(page: Page, user: MockUser) {
  await page.route("**/api/auth/user", (route) => fulfillJson(route, { user }));
  await page.route("**/api/settings", (route) =>
    fulfillJson(route, { default_model: modelId, theme: "dark" })
  );
  await page.route("**/api/models", (route) =>
    fulfillJson(route, {
      models: [{ id: modelId, context_length: 128000 }],
      catalog: [{ id: modelId, context_length: 128000, is_enabled: true }],
    })
  );
  await page.route("**/api/connections", (route) =>
    fulfillJson(route, { connections: [] })
  );
  await page.route("**/api/github/installations", (route) =>
    fulfillJson(route, [])
  );
  await page.route("**/api/github/owners", (route) => fulfillJson(route, []));
}

export async function mockActivationFlow(
  page: Page,
  options?: {
    observabilityCalls?: ObservabilityCallFixture[];
    initialRepos?: MockRepo[];
    sandboxLaunchError?: { error: string; status?: number };
    user?: MockUser;
  }
) {
  let repos: MockRepo[] = options?.initialRepos ?? [];
  let lastChatBody: Record<string, unknown> | null = null;
  let sandboxLaunchRequests = 0;
  let sandboxLaunchError = options?.sandboxLaunchError ?? null;
  const observabilityCalls = options?.observabilityCalls ?? [];
  const user = options?.user ?? connectedUser;
  const conversations = new Map<
    string,
    {
      id: string;
      messages: unknown[];
      local_msgs: unknown[];
      model: string;
      mode: string;
      title: string | null;
      updated_at: string | null;
    }
  >();
  const sandboxesByRepo = new Map<string, SandboxFixture>();

  await page.route("**/__e2e/preview/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><html><body><main><h1>Demo Preview</h1><p>Sandbox is running.</p></main></body></html>",
    });
  });

  await page.route("**/api/auth/user", (route) => fulfillJson(route, { user }));
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
  await page.route("**/api/observability/stats", (route) =>
    fulfillJson(route, buildObservabilitySummary(observabilityCalls))
  );
  await page.route(/\/api\/observability\/jobs(?:\?.*)?$/, (route) =>
    fulfillJson(route, { jobs: [], total: 0, page: 1, limit: 25 })
  );
  await page.route(
    /\/api\/observability\/automation-events(?:\?.*)?$/,
    (route) => fulfillJson(route, { events: [], total: 0, page: 1, limit: 25 })
  );
  await page.route(
    /\/api\/observability\/automation-failures(?:\?.*)?$/,
    (route) => fulfillJson(route, emptyAutomationFailuresResponse)
  );
  await page.route("**/api/observability/calls?*", (route) => {
    const url = new URL(route.request().url());
    const liveOnly = url.searchParams.get("live_only") === "true";
    const repoId = url.searchParams.get("repo_id");
    const sandboxRecordId = url.searchParams.get("sandbox_record_id");
    let filteredCalls = repoId
      ? observabilityCalls.filter((call) => call.repo_id === repoId)
      : observabilityCalls;

    if (sandboxRecordId) {
      filteredCalls = filteredCalls.filter(
        (call) => call.sandbox_context?.sandbox_record_id === sandboxRecordId
      );
    }

    if (liveOnly) {
      filteredCalls = filteredCalls.filter(
        (call) => call.status === "pending" || call.status === "streaming"
      );
    }

    return fulfillJson(route, {
      calls: filteredCalls,
      total: filteredCalls.length,
      page: 1,
      limit: liveOnly ? 100 : 50,
    });
  });
  await page.route("**/api/observability/call-events?*", (route) =>
    fulfillJson(route, { events: [] })
  );
  await page.route(/\/api\/conversations(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());

    if (route.request().method() === "GET") {
      const id = url.searchParams.get("id");
      if (id) {
        await fulfillJson(
          route,
          conversations.get(id) ?? {
            id,
            messages: [],
            local_msgs: [],
            model: modelId,
            mode: "AUTO",
            title: null,
            updated_at: null,
          }
        );
        return;
      }

      await fulfillJson(route, []);
      return;
    }

    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON() as {
        id: string;
        messages?: unknown[];
        local_msgs?: unknown[];
        model?: string;
        mode?: string;
        title?: string | null;
      };
      const current = conversations.get(body.id);
      const conversation = {
        id: body.id,
        messages: body.messages ?? current?.messages ?? [],
        local_msgs: body.local_msgs ?? current?.local_msgs ?? [],
        model: body.model ?? current?.model ?? modelId,
        mode: body.mode ?? current?.mode ?? "AUTO",
        title: body.title ?? current?.title ?? null,
        updated_at: new Date().toISOString(),
      };
      conversations.set(body.id, conversation);
      await fulfillJson(route, { ok: true, conversation });
      return;
    }

    await fulfillJson(route, {});
  });

  await page.route(/\/api\/repos(?:\?.*)?$/, (route) =>
    fulfillJson(route, repos)
  );
  await page.route("**/api/github/repos", async (route) => {
    repos = [syncedRepo];
    await fulfillJson(route, repos);
  });

  await page.route(/\/api\/sandbox\/[^/]+\/health$/, async (route) => {
    const sandboxId = route.request().url().split("/").at(-2);
    const sandbox = Array.from(sandboxesByRepo.values()).find(
      (entry) => entry.id === sandboxId
    );

    await fulfillJson(route, {
      health: { status: sandbox?.health_status || "running" },
      sandbox: sandbox
        ? {
            ...sandbox,
            ...buildSandboxSummaries(sandbox),
          }
        : { health_status: "running" },
    });
  });

  await page.route(/\/api\/sandbox\/[^/]+\/files(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "POST") {
      await fulfillJson(route, {
        entries: [
          { name: "src", isDir: true, size: 0 },
          { name: "package.json", isDir: false, size: 640 },
        ],
      });
      return;
    }

    if (route.request().method() === "GET") {
      await fulfillJson(route, { content: '{"name":"demo-app"}' });
      return;
    }

    await fulfillJson(route, { ok: true });
  });

  // File tree pane uses /tree endpoint instead of /files
  await page.route(/\/api\/sandbox\/[^/]+\/tree(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, {
        paths: ["src/", "package.json"],
      });
      return;
    }

    // PATCH for move, POST for create, DELETE for delete
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as {
        moves: Array<{ fromPath: string; toPath: string }>;
      };
      await fulfillJson(route, { moves: body.moves });
      return;
    }

    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { path: string };
      await fulfillJson(route, { path: body.path });
      return;
    }

    if (route.request().method() === "DELETE") {
      const body = route.request().postDataJSON() as { path: string };
      await fulfillJson(route, { path: body.path });
      return;
    }

    await fulfillJson(route, { ok: true });
  });

  await page.route(/\/api\/sandbox$/, async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, {
        sandboxes: Array.from(sandboxesByRepo.values()),
      });
      return;
    }

    if (route.request().method() === "POST") {
      sandboxLaunchRequests += 1;

      if (sandboxLaunchError) {
        await fulfillJson(
          route,
          { error: sandboxLaunchError.error },
          sandboxLaunchError.status ?? 400
        );
        return;
      }

      const requestBody = route.request().postDataJSON() as { repoId: string };
      const existingSandbox = sandboxesByRepo.get(requestBody.repoId);

      if (existingSandbox) {
        Object.assign(existingSandbox, buildSandboxSummaries(existingSandbox));
        await fulfillJson(route, { sandbox: existingSandbox });
        return;
      }

      const sandbox = buildSandboxFixture({
        repoId: requestBody.repoId,
      });
      sandboxesByRepo.set(requestBody.repoId, sandbox);
      await fulfillJson(route, { sandbox });
      return;
    }

    await fulfillJson(route, {});
  });

  await page.route(/\/api\/sandbox\/[^/]+\/stop$/, async (route) => {
    const sandboxId = route.request().url().split("/").at(-2);
    const sandbox = Array.from(sandboxesByRepo.values()).find(
      (entry) => entry.id === sandboxId
    );

    if (route.request().method() === "POST") {
      if (!sandbox) {
        await fulfillJson(route, { error: "Not found" }, 404);
        return;
      }

      sandbox.status = "stopped";
      sandbox.health_status = "stopped";
      Object.assign(sandbox, buildSandboxSummaries(sandbox));
      await fulfillJson(route, { sandbox });
      return;
    }

    await fulfillJson(route, {});
  });

  await page.route(/\/api\/sandbox\/[^/]+$/, async (route) => {
    const sandboxId = route.request().url().split("/").pop();
    const sandbox = Array.from(sandboxesByRepo.values()).find(
      (entry) => entry.id === sandboxId
    );

    if (route.request().method() === "DELETE") {
      if (!sandbox) {
        await fulfillJson(route, { error: "Not found" }, 404);
        return;
      }

      sandbox.status = "stopped";
      sandbox.health_status = "stopped";
      Object.assign(sandbox, buildSandboxSummaries(sandbox));
      await fulfillJson(route, { sandbox });
      return;
    }

    if (route.request().method() === "GET") {
      if (!sandbox) {
        await fulfillJson(route, { error: "Not found" }, 404);
        return;
      }

      Object.assign(sandbox, buildSandboxSummaries(sandbox));
      await fulfillJson(route, { sandbox });
      return;
    }

    await fulfillJson(route, {});
  });

  await page.route(/\/api\/chat(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "POST") {
      const rawBody = route.request().postData();
      if (rawBody) {
        try {
          lastChatBody = JSON.parse(rawBody) as Record<string, unknown>;
        } catch {
          lastChatBody = { rawBody };
        }
      }
    }
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "x-vercel-ai-ui-message-stream": "v1",
      },
      body: buildUiMessageStreamBody("Applied preview feedback."),
    });
  });

  return {
    getLastChatBody: () => lastChatBody,
    getSandboxLaunchRequests: () => sandboxLaunchRequests,
    setSandboxLaunchError: (
      next: { error: string; status?: number } | null
    ) => {
      sandboxLaunchError = next;
    },
    setSandboxState: (
      repoId: string,
      updates: Partial<{
        billing_source: "platform" | "user_vercel_project" | null;
        billing_team_id: string | null;
        billing_project_id: string | null;
        vercel_team_id: string | null;
        vercel_project_id: string | null;
        status: string;
        health_status: string;
        preview_url: string | null;
        last_active_at: string;
        last_preview_http_status: number | null;
        last_preview_error: string | null;
        last_boot_error: string | null;
        current_error: string | null;
        billing_summary: SandboxBillingSummary;
        vercel_diagnostics: SandboxVercelDiagnostics | null;
      }>
    ) => {
      const current = sandboxesByRepo.get(repoId);
      if (!current) {
        throw new Error(`Sandbox for repo ${repoId} was not initialized`);
      }
      Object.assign(current, updates);
      Object.assign(current, buildSandboxSummaries(current));
      if (updates.current_error !== undefined && current.error_summary) {
        current.error_summary.current_error = updates.current_error;
        current.error_summary.display_error =
          updates.current_error ??
          current.last_preview_error ??
          current.last_boot_error ??
          null;
        current.error_summary.has_errors = Boolean(
          current.error_summary.display_error
        );
      }
    },
    seedSandbox: (
      repoId: string,
      updates?: Partial<{
        billing_source: "platform" | "user_vercel_project" | null;
        billing_team_id: string | null;
        billing_project_id: string | null;
        vercel_team_id: string | null;
        vercel_project_id: string | null;
        status: string;
        health_status: string;
        preview_url: string | null;
        last_active_at: string;
        last_preview_http_status: number | null;
        last_preview_error: string | null;
        last_boot_error: string | null;
        current_error: string | null;
        boot_attempts: number;
        billing_summary: SandboxBillingSummary;
        vercel_diagnostics: SandboxVercelDiagnostics | null;
      }>
    ) => {
      const sandbox = buildSandboxFixture({
        repoId,
        billingSource: updates?.billing_source,
        billingTeamId: updates?.billing_team_id,
        billingProjectId: updates?.billing_project_id,
        vercelTeamId: updates?.vercel_team_id,
        vercelProjectId: updates?.vercel_project_id,
        status: updates?.status,
        previewUrl: updates?.preview_url,
        healthStatus: updates?.health_status,
        lastActiveAt: updates?.last_active_at,
        lastPreviewHttpStatus: updates?.last_preview_http_status,
        lastPreviewError: updates?.last_preview_error,
        lastBootError: updates?.last_boot_error,
        bootAttempts: updates?.boot_attempts,
        billingSummary: updates?.billing_summary,
        vercelDiagnostics: updates?.vercel_diagnostics,
      });
      if (updates?.current_error !== undefined && sandbox.error_summary) {
        sandbox.error_summary.current_error = updates.current_error;
        sandbox.error_summary.display_error =
          updates.current_error ??
          sandbox.last_preview_error ??
          sandbox.last_boot_error ??
          null;
        sandbox.error_summary.has_errors = Boolean(
          sandbox.error_summary.display_error
        );
      }
      sandboxesByRepo.set(repoId, sandbox);
    },
  };
}

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
