import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  fulfillJson,
  mockBaseChrome,
} from "./helpers/automation-control-plane-fixtures";

const NOW = new Date().toISOString();

function sandboxRecord(
  status: string,
  {
    id = "rec-1",
    repoId = "repo-1",
    sandboxId = "sbx_live123",
    branch = "feat/demo",
    lastActiveAt = NOW,
  }: {
    id?: string;
    repoId?: string;
    sandboxId?: string;
    branch?: string;
    lastActiveAt?: string;
  } = {}
) {
  return {
    id,
    user_id: "00000000-0000-4000-8000-000000000001",
    repo_id: repoId,
    sandbox_id: sandboxId,
    base_branch: "main",
    working_branch: branch,
    limit_claim_id: null,
    status,
    preview_url:
      status === "running" ? "https://preview.example.vercel.app" : null,
    snapshot_id: null,
    error: null,
    stop_reason: null,
    install_log: null,
    dev_log: null,
    runtime: null,
    terminal_cwd: null,
    created_at: NOW,
    last_active_at: lastActiveAt,
    runtime_summary: {
      sandbox_id: sandboxId,
      status,
      health_status: "unknown",
      preview_url:
        status === "running" ? "https://preview.example.vercel.app" : null,
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

test("control sandboxes panel shows live sandbox cards and preview", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockBaseChrome(page);
  await page.route("**/api/connections", (route) =>
    fulfillJson(route, { connections: [] })
  );
  await page.route("**/api/control/worktrees**", (route) =>
    fulfillJson(route, { worktrees: [] })
  );
  await page.route("**/api/repos", (route) =>
    fulfillJson(route, [
      {
        id: "repo-1",
        full_name: "acme/widgets",
        owner: "acme",
        name: "widgets",
        default_branch: "main",
      },
      {
        id: "repo-2",
        full_name: "acme/unrelated",
        owner: "acme",
        name: "unrelated",
        default_branch: "main",
      },
    ])
  );
  await page.route("**/api/control/sessions**", (route) => {
    const request = route.request();
    if (request.method() === "GET") return fulfillJson(route, []);
    if (request.method() === "POST") {
      const body = request.postDataJSON() as {
        title?: string;
        project?: string | null;
        repo_id?: string | null;
      };
      return fulfillJson(route, {
        id: "sess-worktrees",
        title: body.title ?? "Session",
        project: body.project ?? null,
        repo_id: body.repo_id ?? null,
        pinned: false,
        archived: false,
        messages: [],
        created_at: NOW,
        updated_at: NOW,
      });
    }
    return route.fallback();
  });

  let stopped = false;
  let stopPosted = false;
  let restartPosted = false;
  let resumePosted = false;
  const chatRequests: Array<{ sandboxId?: string | null }> = [];
  await page.route("**/api/sandbox/rec-1/stop", (route) => {
    stopPosted = true;
    stopped = true;
    return fulfillJson(route, { ok: true });
  });
  await page.route("**/api/sandbox/rec-1/restart", (route) => {
    restartPosted = true;
    stopped = false;
    return fulfillJson(route, { sandbox: sandboxRecord("running") });
  });
  await page.route("**/api/sandbox/rec-paused/resume", (route) => {
    resumePosted = true;
    return fulfillJson(route, {
      sandbox: sandboxRecord("running", {
        id: "rec-paused",
        sandboxId: "sbx_paused",
        branch: "feat/paused",
        lastActiveAt: new Date(Date.now() - 60_000).toISOString(),
      }),
    });
  });
  await page.route("**/api/sandbox", (route) =>
    fulfillJson(route, {
      sandboxes: [
        sandboxRecord(stopped ? "stopped" : "running"),
        sandboxRecord("paused", {
          id: "rec-paused",
          sandboxId: "sbx_paused",
          branch: "feat/paused",
          lastActiveAt: new Date(Date.now() - 60_000).toISOString(),
        }),
        sandboxRecord("running", {
          id: "rec-2",
          repoId: "repo-2",
          sandboxId: "sbx_unrelated",
          branch: "feat/unrelated",
          lastActiveAt: new Date(Date.now() + 60_000).toISOString(),
        }),
      ],
    })
  );

  const streamChunks = [
    { type: "start" },
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: "Starting the run now." },
    { type: "text-end", id: "t1" },
    { type: "finish" },
  ];
  const streamBody =
    streamChunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") +
    "data: [DONE]\n\n";
  await page.route("**/api/control/chat", (route) => {
    chatRequests.push(route.request().postDataJSON() as { sandboxId?: string });
    return route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "x-vercel-ai-ui-message-stream": "v1",
      },
      body: streamBody,
    });
  });

  await page.goto(scopedPath("control"));
  await page.waitForLoadState("networkidle");

  await page
    .getByPlaceholder("Ask anything or run a command...")
    .fill("Run the tests");
  await page.getByRole("button", { name: "Start mission" }).click();
  await expect(page).toHaveURL(/\/control\?mission=sess-worktrees$/);
  await expect(
    page.getByText("acme/widgets", { exact: true }).last()
  ).toBeVisible();

  // One branch tab per active sandbox appears next to Chat / Sandboxes.
  await expect(page.getByRole("button", { name: "feat/demo" })).toBeVisible();
  await expect(page.getByRole("button", { name: "feat/paused" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "feat/unrelated" })
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sandboxes 2" })).toBeVisible();
  expect(chatRequests[0]?.sandboxId).toBe("rec-1");

  // Branch tabs select the exact sandbox context sent to the agent.
  const pausedTab = page.getByRole("button", { name: "feat/paused" });
  await pausedTab.click();
  await expect(pausedTab).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Chat" }).click();
  await page
    .getByPlaceholder("Ask for follow-up changes or attach images")
    .fill("Continue in the paused sandbox");
  await page.keyboard.press("Enter");
  await expect.poll(() => chatRequests.length).toBe(2);
  expect(chatRequests[1]?.sandboxId).toBe("rec-paused");

  // The Sandboxes tab shows remote compute with real status and actions.
  await page.getByRole("button", { name: "Sandboxes 2" }).click();
  await expect(page.getByRole("heading", { name: "Sandboxes" })).toBeVisible();
  await expect(page.getByText("sbx_live123")).toHaveCount(0);
  await expect(page.getByText("feat/demo").first()).toBeVisible();
  await expect(page.getByText("Running").first()).toBeVisible();
  await expect(
    page.getByText("No recent output for this sandbox.").first()
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Preview" }).first()
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Stop" }).first()
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();

  // A paused sandbox can be resumed without creating a replacement, so its
  // persisted worktree binding remains valid.
  await page.getByRole("button", { name: "Resume" }).click();
  await expect.poll(() => resumePosted).toBe(true);
  await expect(page.getByText("Running")).toHaveCount(2);

  // Preview opens the real sandbox URL in a modal and closes again.
  await page.getByRole("button", { name: "Preview" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText("https://preview.example.vercel.app")
  ).toBeVisible();
  await expect(dialog.getByText("feat/demo")).toBeVisible();
  await dialog.getByRole("button", { name: "Close preview" }).click();
  await expect(dialog).toBeHidden();

  // Stop hits the real endpoint and the card reflects the new state.
  await page.getByRole("button", { name: "Stop" }).first().click();
  await expect.poll(() => stopPosted).toBe(true);
  await expect(page.getByText("Stopped").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Restart" })).toBeVisible();

  // A stopped sandbox restarts through its existing record instead of
  // creating unrelated compute that would strand the worktree binding.
  await page.getByRole("button", { name: "Restart" }).click();
  await expect.poll(() => restartPosted).toBe(true);
  await expect(page.getByText("Running")).toHaveCount(2);

  // The dashed spawn card stays available.
  await expect(
    page.getByRole("button", { name: /Start sandbox/ }).first()
  ).toBeVisible();
});
