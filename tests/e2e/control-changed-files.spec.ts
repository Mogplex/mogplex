import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  fulfillJson,
  mockBaseChrome,
  mockControlSessionBootstrap,
} from "./helpers/automation-control-plane-fixtures";

const NOW = new Date().toISOString();

function runningSandbox() {
  return {
    id: "rec-live",
    user_id: "00000000-0000-4000-8000-000000000001",
    repo_id: "repo-control-default",
    sandbox_id: "sbx_live123",
    base_branch: "main",
    working_branch: "mogplex/agent-live",
    limit_claim_id: null,
    status: "running",
    preview_url: null,
    snapshot_id: null,
    error: null,
    stop_reason: null,
    install_log: null,
    dev_log: null,
    runtime: null,
    terminal_cwd: null,
    root_directory: null,
    created_at: NOW,
    last_active_at: NOW,
    runtime_summary: {
      sandbox_id: "sbx_live123",
      status: "running",
      health_status: "unknown",
      preview_url: null,
      last_health_check_at: null,
      last_preview_http_status: null,
      boot_attempts: 0,
      last_boot_started_at: null,
      last_boot_completed_at: null,
    },
    billing_summary: {
      source: "platform",
      label: "Platform",
      project_id: null,
      team_id: null,
      team_label: null,
    },
    error_summary: {
      current_error: null,
      last_preview_error: null,
      last_boot_error: null,
      display_error: null,
      has_errors: false,
    },
  };
}

test("control shows the sandbox working tree with diff, revert, and commit", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockBaseChrome(page);
  await mockControlSessionBootstrap(page);
  await page.route("**/api/connections", (route) =>
    fulfillJson(route, { connections: [] })
  );
  await page.route("**/api/sandbox", (route) =>
    fulfillJson(route, { sandboxes: [runningSandbox()] })
  );

  let changes = {
    branch: "mogplex/agent-live",
    baseBranch: "main",
    ahead: 0,
    behind: 0,
    files: [
      { path: "src/app.ts", status: "modified", additions: 3, deletions: 1 },
      { path: "docs/new.md", status: "untracked", additions: 7, deletions: 0 },
    ],
  };
  const posts: Array<Record<string, unknown>> = [];
  await page.route(
    /\/api\/sandbox\/rec-live\/changes(?:\?.*)?$/,
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === "GET" && url.searchParams.has("path")) {
        await route.fulfill({
          json: {
            path: url.searchParams.get("path"),
            diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,2 +1,2 @@\n-const old = 1;\n+const fresh = 2;\n unchanged\n",
          },
        });
        return;
      }
      if (request.method() === "GET") {
        await route.fulfill({ json: changes });
        return;
      }
      const body = request.postDataJSON() as Record<string, unknown>;
      posts.push(body);
      if (body.action === "revert") {
        const reverted = new Set(body.paths as string[]);
        changes = {
          ...changes,
          files: changes.files.filter((file) => !reverted.has(file.path)),
        };
        await route.fulfill({ json: { reverted: [...reverted], changes } });
        return;
      }
      changes = { ...changes, files: [], ahead: 1 };
      await route.fulfill({
        json: {
          committed: true,
          sha: "abc123",
          pushed: true,
          pullRequestUrl: "https://github.com/acme/widgets/pull/7",
          changes,
        },
      });
    }
  );

  const streamBody =
    [
      { type: "start" },
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", delta: "Done." },
      { type: "text-end", id: "t1" },
      { type: "finish" },
    ]
      .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
      .join("") + "data: [DONE]\n\n";
  await page.route("**/api/control/chat", (route) =>
    route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "x-vercel-ai-ui-message-stream": "v1",
      },
      body: streamBody,
    })
  );

  await page.goto(scopedPath("control"));
  await page.waitForLoadState("networkidle");
  await page
    .getByPlaceholder("Ask anything or run a command...")
    .fill("Rename the constant");
  await page.getByRole("button", { name: "Start mission" }).click();

  const bar = page.getByTestId("changed-files-bar");
  await expect(bar).toContainText("2 files changed");
  await expect(bar).toContainText("mogplex/agent-live");

  await page.getByTestId("changed-files-toggle").click();
  await page
    .getByTestId("changed-file-src/app.ts")
    .getByText("src/app.ts")
    .click();
  await expect(page.getByRole("dialog")).toContainText("const fresh = 2;");
  await page.keyboard.press("Escape");

  await page
    .getByTestId("changed-file-docs/new.md")
    .getByTestId("changed-file-revert")
    .click();
  await page
    .getByTestId("changed-file-docs/new.md")
    .getByTestId("changed-file-revert-confirm")
    .click();
  await expect(bar).toContainText("1 file changed");
  expect(posts[0]).toEqual({ action: "revert", paths: ["docs/new.md"] });

  await page.getByTestId("changed-files-commit").click();
  await expect(page.getByTestId("changed-files-commit-message")).toHaveValue(
    "Rename the constant"
  );
  await page.getByTestId("changed-files-commit-pr").click();
  await expect(
    page.getByRole("link", { name: "Open pull request" })
  ).toHaveAttribute("href", "https://github.com/acme/widgets/pull/7");
  expect(posts[1]).toEqual({
    action: "commit",
    message: "Rename the constant",
    push: true,
    openPullRequest: true,
  });
});
