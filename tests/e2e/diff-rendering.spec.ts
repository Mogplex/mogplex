import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  emptyAutomationFailuresResponse,
  linkedVercelCapability,
} from "./helpers/activation-fixtures";
import type { Page, Route } from "@playwright/test";

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

const repo = {
  id: "repo-1",
  full_name: "acme/demo-app",
  owner: "acme",
  name: "demo-app",
  default_branch: "main",
  is_hidden: false,
  is_favorite: false,
};

const modelId = "minimax/minimax-m2.5";

function buildUiMessageStreamBody(text: string) {
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

function buildUiEventStreamBody(events: unknown[]) {
  return [
    ...events.flatMap((event) => [`data: ${JSON.stringify(event)}`, ""]),
    "data: [DONE]",
    "",
  ].join("\n");
}

async function fulfillJson(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(data),
  });
}

async function mockBaseApp(page: Page) {
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

test("composer shows agent activity immediately and clears it after completion", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockBaseApp(page);

  await page.route(/\/api\/conversations(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, {
        messages: [],
        local_msgs: [],
        model: modelId,
        mode: "AUTO",
      });
      return;
    }
    await fulfillJson(route, { ok: true });
  });

  let releaseResponse: (() => void) | undefined;
  const responseReleased = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  let chatRequests = 0;
  await page.route("**/api/chat", async (route) => {
    chatRequests += 1;
    await responseReleased;
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "x-vercel-ai-ui-message-stream": "v1",
      },
      body: buildUiMessageStreamBody("Finished the work."),
    });
  });

  await page.goto(scopedPath("projects/workspace"));
  await page.waitForLoadState("networkidle");
  await page.getByTestId(`home-open-workspace-${repo.id}`).click();
  const composer = page.getByRole("textbox", {
    name: "Ask the agent what to build, fix, or explain. Type / for commands or drop files here.",
  });
  await composer.fill("do the work");
  await page.keyboard.press("Enter");

  const indicator = page.getByTestId("agent-running-indicator");
  await expect(indicator).toContainText("Agent is working");
  await expect(indicator.getByRole("button", { name: "Stop" })).toBeVisible();

  const runningComposer = page.getByRole("textbox", {
    name: "Agent is working. You can draft the next message here.",
  });
  await runningComposer.fill("/");
  await page.keyboard.press("Tab");
  await expect(runningComposer).toHaveValue("/");
  expect(chatRequests).toBe(1);

  releaseResponse?.();
  await expect(page.getByText("Finished the work.")).toBeVisible();
  await expect(indicator).toHaveCount(0);
});

test("assistant diff blocks render through the shared diff viewer", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockBaseApp(page);

  await page.route(/\/api\/conversations(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, {
        messages: [],
        local_msgs: [],
        model: modelId,
        mode: "AUTO",
      });
      return;
    }
    await fulfillJson(route, { ok: true });
  });
  await page.route("**/api/chat", async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "x-vercel-ai-ui-message-stream": "v1",
      },
      body: buildUiMessageStreamBody(
        [
          "I changed the greeting.",
          "",
          "```diff",
          "diff --git a/src/greeting.ts b/src/greeting.ts",
          "index 1111111..2222222 100644",
          "--- a/src/greeting.ts",
          "+++ b/src/greeting.ts",
          "@@ -1 +1 @@",
          "-export const greeting = 'hello'",
          "+export const greeting = 'hello there'",
          "```",
        ].join("\n")
      ),
    });
  });

  await page.goto(scopedPath("projects/workspace"));
  await page.waitForLoadState("networkidle");
  await page.getByTestId(`home-open-workspace-${repo.id}`).click();
  await page
    .getByRole("textbox", {
      name: "Ask the agent what to build, fix, or explain. Type / for commands or drop files here.",
    })
    .fill("show me the patch");
  await page.keyboard.press("Enter");

  await expect(page.getByText("Workspace Chat · demo-app")).toBeVisible();
  await expect(page.getByText("src/greeting.ts")).toBeVisible();
  await expect(
    page.getByText("export const greeting = 'hello there'")
  ).toBeVisible();
  await expect(
    page.getByText("diff --git a/src/greeting.ts b/src/greeting.ts")
  ).toHaveCount(0);
});

test("malformed diff fences fall back to the normal code renderer", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockBaseApp(page);

  await page.route(/\/api\/conversations(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, {
        messages: [],
        local_msgs: [],
        model: modelId,
        mode: "AUTO",
      });
      return;
    }
    await fulfillJson(route, { ok: true });
  });
  await page.route("**/api/chat", async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "x-vercel-ai-ui-message-stream": "v1",
      },
      body: buildUiMessageStreamBody(
        [
          "This patch is malformed on purpose.",
          "",
          "```diff",
          "this is not a patch",
          "just plain text inside a diff fence",
          "```",
        ].join("\n")
      ),
    });
  });

  await page.goto(scopedPath("projects/workspace"));
  await page.waitForLoadState("networkidle");
  await page.getByTestId(`home-open-workspace-${repo.id}`).click();
  await page
    .getByRole("textbox", {
      name: "Ask the agent what to build, fix, or explain. Type / for commands or drop files here.",
    })
    .fill("show me the malformed patch");
  await page.keyboard.press("Enter");

  await expect(page.getByText("this is not a patch")).toBeVisible();
  await expect(
    page.getByText("just plain text inside a diff fence")
  ).toBeVisible();
  await expect(page.getByText("src/greeting.ts")).toHaveCount(0);
});

test("saved local messages render patches through the shared diff viewer", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockBaseApp(page);

  const patch = [
    "diff --git a/src/local.ts b/src/local.ts",
    "index 1111111..2222222 100644",
    "--- a/src/local.ts",
    "+++ b/src/local.ts",
    "@@ -1 +1 @@",
    "-export const source = 'old'",
    "+export const source = 'local'",
    "",
  ].join("\n");

  await page.route(/\/api\/conversations(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, {
        messages: [],
        local_msgs: [{ id: "local-1", text: patch }],
        model: modelId,
        mode: "AUTO",
      });
      return;
    }
    await fulfillJson(route, { ok: true });
  });

  await page.goto(scopedPath("projects/workspace"));
  await page.waitForLoadState("networkidle");
  await page.getByTestId(`home-open-workspace-${repo.id}`).click();

  await expect(page.getByText("src/local.ts")).toBeVisible();
  await expect(page.getByText("export const source = 'local'")).toBeVisible();
});

test("assistant tool parts render nested diff output through the shared viewer", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockBaseApp(page);

  const patch = [
    "diff --git a/src/tool.ts b/src/tool.ts",
    "index 1111111..2222222 100644",
    "--- a/src/tool.ts",
    "+++ b/src/tool.ts",
    "@@ -1 +1 @@",
    "-export const toolState = 'waiting'",
    "+export const toolState = 'done'",
    "",
  ].join("\n");

  await page.route(/\/api\/conversations(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, {
        messages: [],
        local_msgs: [],
        model: modelId,
        mode: "AUTO",
      });
      return;
    }
    await fulfillJson(route, { ok: true });
  });
  await page.route("**/api/chat", async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "x-vercel-ai-ui-message-stream": "v1",
      },
      body: buildUiEventStreamBody([
        {
          type: "tool-input-available",
          toolCallId: "tool-call-1",
          toolName: "git_diff",
          input: { repo: repo.full_name },
        },
        {
          type: "tool-output-available",
          toolCallId: "tool-call-1",
          output: { stdout: patch },
        },
      ]),
    });
  });

  await page.goto(scopedPath("projects/workspace"));
  await page.waitForLoadState("networkidle");
  await page.getByTestId(`home-open-workspace-${repo.id}`).click();
  await page
    .getByRole("textbox", {
      name: "Ask the agent what to build, fix, or explain. Type / for commands or drop files here.",
    })
    .fill("show me the tool output");
  await page.keyboard.press("Enter");
  await page.getByText("git_diff").click();

  await expect(page.getByText("Diff source: stdout")).toBeVisible();
  await expect(page.getByText("src/tool.ts")).toBeVisible();
  await expect(page.getByText("export const toolState = 'done'")).toBeVisible();
});

test("diff pane renders pull request patches with the shared diff viewer", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockBaseApp(page);
  await page.route(/\/api\/conversations(?:\?.*)?$/, (route) =>
    fulfillJson(route, {
      messages: [],
      local_msgs: [],
      model: modelId,
      mode: "AUTO",
    })
  );

  const patch = [
    "diff --git a/src/widget.ts b/src/widget.ts",
    "index 1111111..2222222 100644",
    "--- a/src/widget.ts",
    "+++ b/src/widget.ts",
    "@@ -1 +1 @@",
    "-export const status = 'idle'",
    "+export const status = 'running'",
    "",
  ].join("\n");

  await page.route("**/api/github/pulls", (route) =>
    fulfillJson(route, {
      pulls: [
        {
          number: 42,
          title: "Update widget status",
          state: "open",
          html_url: "https://github.com/acme/demo-app/pull/42",
          user: { login: "alex" },
          additions: 1,
          deletions: 1,
          changed_files: 1,
        },
      ],
      diff: patch,
    })
  );
  await page.route("**/api/github/pulls?pr=42", (route) =>
    fulfillJson(route, {
      pulls: [
        {
          number: 42,
          title: "Update widget status",
          state: "open",
          html_url: "https://github.com/acme/demo-app/pull/42",
          user: { login: "alex" },
          additions: 1,
          deletions: 1,
          changed_files: 1,
        },
      ],
      diff: patch,
    })
  );

  await page.goto(scopedPath("projects/workspace"));
  await page.waitForLoadState("networkidle");
  await page.getByTestId(`home-open-workspace-${repo.id}`).click();
  await page.getByTitle("Add pane").first().click();
  // The add-pane menu lists each pane type twice (split right + "Split below");
  // take the first (horizontal split).
  await page.getByRole("menuitem", { name: "Diff" }).first().click();

  await expect(page.getByText("#42")).toBeVisible();
  await expect(page.getByText("Update widget status")).toBeVisible();
  await expect(page.getByText("src/widget.ts")).toBeVisible();
  await expect(page.getByText("export const status = 'running'")).toBeVisible();
});

test("observability renders nested tool output diffs with the shared viewer", async ({
  page,
}) => {
  const now = new Date().toISOString();
  const patch = [
    "diff --git a/src/agent.ts b/src/agent.ts",
    "index 1111111..2222222 100644",
    "--- a/src/agent.ts",
    "+++ b/src/agent.ts",
    "@@ -1 +1 @@",
    "-export const mode = 'idle'",
    "+export const mode = 'ready'",
    "",
  ].join("\n");

  // Register the base mocks FIRST: Playwright matches routes in reverse
  // registration order (last registered wins), so the observability-specific
  // mocks below must come after mockBaseApp's empty-calls defaults.
  await enableScopedE2EAuth(page);
  await mockBaseApp(page);

  await page.route("**/api/observability/calls*", (route) =>
    fulfillJson(route, {
      calls: [
        {
          id: "call-1",
          user_id: connectedUser.id,
          type: "chat",
          model: modelId,
          input_tokens: 10,
          output_tokens: 12,
          total_tokens: 22,
          duration_ms: 1200,
          started_at: now,
          completed_at: now,
          status: "success",
          error: null,
          conversation_id: "conversation-1",
          job_run_id: null,
          repo_id: repo.id,
          tool_calls_count: 1,
          tool_calls: [
            {
              name: "git_diff",
              input_preview: '{"repo":"acme/demo-app"}',
              input: { repo: repo.full_name },
              output_preview: "diff --git a/src/agent.ts b/src/agent.ts",
              output: { stdout: patch },
              duration_ms: 75,
            },
          ],
          metadata: { repo: repo.full_name },
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
    })
  );
  await page.route(/\/api\/observability\/call-events(?:\?.*)?$/, (route) =>
    fulfillJson(route, { events: [] })
  );
  await page.route("**/api/observability/stats*", (route) =>
    fulfillJson(route, {
      summary: {
        total_calls: 1,
        total_tokens: 22,
        total_cost: 0,
        cost_today: 0,
        reconciliation_pending: 0,
        avg_duration_ms: 1200,
        success_rate: 1,
        calls_today: 1,
        tokens_today: 22,
        sandbox_time_ms: 0,
        sandbox_active: 0,
        sandbox_total: 0,
        job_runs_total: 0,
        job_runs_running: 0,
        job_runs_pending: 0,
        job_runs_stale_pending: 0,
        job_runs_failed_in_range: 0,
        job_runs_repaired_in_range: 0,
        job_runs_success_rate_in_range: 0,
        suppressed_in_range: 0,
        deferred_in_range: 0,
        start_failed_in_range: 0,
        limit_allowed_in_range: 0,
        limit_denied_in_range: 0,
        oldest_pending_age_ms: 0,
      },
      by_model: [],
      by_type: [],
    })
  );
  await page.route(
    /\/api\/observability\/automation-events(?:\?.*)?$/,
    (route) =>
      fulfillJson(route, {
        events: [],
        total: 0,
        page: 1,
        limit: 25,
      })
  );
  await page.route(
    /\/api\/observability\/automation-failures(?:\?.*)?$/,
    (route) => fulfillJson(route, emptyAutomationFailuresResponse)
  );
  await page.route(/\/api\/observability\/jobs(?:\?.*)?$/, (route) =>
    fulfillJson(route, {
      jobs: [],
      total: 0,
      page: 1,
      limit: 25,
    })
  );

  // Expand the call row via the call_id query param instead of clicking the
  // row: the row-toggle handler navigates through buildObservabilityHref's
  // unscoped "/observability?..." href, which only works in production because
  // proxy.ts rescue-redirects it back into the scope — the e2e bypass skips
  // that rescue, so a click would strand the test on a bogus
  // "/observability" scope.
  await page.goto(scopedPath("observability?call_id=call-1"));
  await page.waitForLoadState("networkidle");

  await expect(
    page.getByRole("heading", { name: "Observability", level: 1 })
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
  await expect(page.getByRole("row", { name: /minimax-m2\.5/i })).toBeVisible();

  await expect(page.getByText("Diff source: stdout")).toBeVisible();
  await expect(page.getByText("src/agent.ts")).toBeVisible();
  await expect(page.getByText("export const mode = 'ready'")).toBeVisible();
});
