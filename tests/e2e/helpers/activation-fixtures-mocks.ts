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
import type { Page } from "@playwright/test";
import type { SandboxVercelDiagnostics } from "@/lib/vercel/sandbox-diagnostics";
import type { MockUser, MockRepo } from "./activation-fixtures-types";
import {
  fulfillJson,
  buildUiMessageStreamBody,
} from "./activation-fixtures-utils";
import {
  modelId,
  connectedUser,
  syncedRepo,
  emptyAutomationFailuresResponse,
} from "./activation-fixtures-data";

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
      repo_id: string | null;
      workspace_session_id: string | null;
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
        await fulfillJson(route, conversations.get(id) ?? null);
        return;
      }

      await fulfillJson(route, []);
      return;
    }

    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON() as {
        id: string;
        repo_id?: string | null;
        workspace_session_id?: string | null;
        messages?: unknown[];
        local_msgs?: unknown[];
        model?: string;
        mode?: string;
        title?: string | null;
      };
      const current = conversations.get(body.id);
      const conversation = {
        id: body.id,
        repo_id: body.repo_id ?? current?.repo_id ?? null,
        workspace_session_id:
          body.workspace_session_id ?? current?.workspace_session_id ?? null,
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
