import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  fulfillJson,
  mockBaseChrome,
} from "./helpers/automation-control-plane-fixtures";

const NOW = new Date().toISOString();

function runningPreviewUrl(status: string, previewUrl: string): string | null {
  return status === "running" ? previewUrl : null;
}

function sandboxRecord(
  status: string,
  {
    id = "rec-1",
    repoId = "repo-1",
    sandboxId = "sbx_live123",
    branch = "feat/demo",
    lastActiveAt = NOW,
    previewUrl = "https://preview.example.vercel.app",
    rootDirectory = null,
    keepPreviewUrl = false,
    error = null,
  }: {
    id?: string;
    repoId?: string;
    sandboxId?: string;
    branch?: string;
    lastActiveAt?: string;
    previewUrl?: string;
    rootDirectory?: string | null;
    keepPreviewUrl?: boolean;
    error?: string | null;
  } = {}
) {
  const resolvedPreviewUrl = keepPreviewUrl
    ? previewUrl
    : runningPreviewUrl(status, previewUrl);
  return {
    id,
    user_id: "00000000-0000-4000-8000-000000000001",
    repo_id: repoId,
    sandbox_id: sandboxId,
    base_branch: "main",
    working_branch: branch,
    limit_claim_id: null,
    status,
    preview_url: resolvedPreviewUrl,
    snapshot_id: null,
    error,
    stop_reason: null,
    install_log: null,
    dev_log: null,
    runtime: null,
    terminal_cwd: null,
    root_directory: rootDirectory,
    created_at: NOW,
    last_active_at: lastActiveAt,
    runtime_summary: {
      sandbox_id: sandboxId,
      status,
      health_status: "unknown",
      preview_url: resolvedPreviewUrl,
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
      current_error: error,
      last_preview_error: null,
      last_boot_error: null,
      display_error: error,
      has_errors: Boolean(error),
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
  let deletePosted = false;
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
        previewUrl: "https://paused-preview.example.vercel.app",
      }),
    });
  });
  await page.route("**/api/sandbox/rec-error", (route) => {
    if (route.request().method() === "DELETE") {
      deletePosted = true;
      return fulfillJson(route, { ok: true, sandboxId: "rec-error" });
    }
    return route.fallback();
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
          id: "rec-clone-a",
          sandboxId: "sbx_clone_alpha_111111",
          branch: "feat/demo",
          previewUrl: "https://clone-a-preview.example.vercel.app",
          lastActiveAt: new Date(Date.now() - 90_000).toISOString(),
        }),
        sandboxRecord("running", {
          id: "rec-clone-b",
          sandboxId: "sbx_clone_beta_222222",
          branch: "feat/demo",
          previewUrl: "https://clone-b-preview.example.vercel.app",
          lastActiveAt: new Date(Date.now() - 100_000).toISOString(),
        }),
        sandboxRecord("running", {
          id: "rec-root",
          sandboxId: "sbx_web_root_333333",
          branch: "feat/web",
          rootDirectory: "apps/web",
          previewUrl: "https://web-preview.example.vercel.app",
          lastActiveAt: new Date(Date.now() - 110_000).toISOString(),
        }),
        sandboxRecord("running", {
          id: "rec-2",
          repoId: "repo-2",
          sandboxId: "sbx_unrelated",
          branch: "feat/unrelated",
          lastActiveAt: new Date(Date.now() + 60_000).toISOString(),
        }),
        sandboxRecord("error", {
          id: "rec-error",
          sandboxId: "sbx_failed",
          branch: "feat/failed",
          error: "Runtime failed to start",
          lastActiveAt: new Date(Date.now() - 120_000).toISOString(),
        }),
        sandboxRecord("stopped", {
          id: "rec-stopped",
          sandboxId: "sbx_stopped",
          branch: "feat/stopped",
          keepPreviewUrl: true,
          lastActiveAt: new Date(Date.now() - 180_000).toISOString(),
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
  // Control view tabs follow the keyboard tab pattern and keep counts distinct.
  const chatTab = page.getByRole("tab", { name: "Chat", exact: true });
  await chatTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "Worktrees, 0 checkouts" })
  ).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", {
      name: "Sandboxes, 5 current sandboxes, 2 previous attempts",
    })
  ).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(chatTab).toHaveAttribute("aria-selected", "true");

  // Sandbox selectors lead with readable repository context, expose status in
  // text, and keep the full runtime ID in secondary detail.
  const selectedSandboxChoice = page.getByRole("button", {
    name: /Select acme\/widgets, branch feat\/demo, Running, sandbox live123/,
  });
  await expect(selectedSandboxChoice).toBeVisible();
  await expect(selectedSandboxChoice).toHaveAttribute("title", "sbx_live123");
  const overflowSelector = page.getByRole("button", {
    name: "Choose from 4 more sandboxes",
  });
  await expect(overflowSelector).toBeVisible();
  await expect(page.getByRole("button", { name: /sbx_unrelated/ })).toHaveCount(
    0
  );
  await expect(
    page.getByRole("tab", {
      name: "Sandboxes, 5 current sandboxes, 2 previous attempts",
    })
  ).toBeVisible();
  expect(chatRequests[0]?.sandboxId).toBe("rec-1");

  // Keyboard selection from overflow updates the exact context sent to the
  // agent and used by preview.
  await overflowSelector.focus();
  await page.keyboard.press("Enter");
  const cloneChoice = page.getByRole("menuitem", {
    name: /Select acme\/widgets, branch feat\/demo, Running, sandbox a_111111/,
  });
  await expect(
    page.getByRole("menuitem", {
      name: /Select acme\/widgets, branch feat\/web, root apps\/web, Running/,
    })
  ).toHaveAttribute("title", "sbx_web_root_333333");
  await cloneChoice.focus();
  await page.keyboard.press("Enter");
  const selectedClone = page.getByRole("button", {
    name: /Select acme\/widgets, branch feat\/demo, Running, sandbox a_111111/,
  });
  await expect(selectedClone).toHaveAttribute("aria-pressed", "true");
  await expect(selectedClone).toHaveAttribute(
    "title",
    "sbx_clone_alpha_111111"
  );
  await expect(page.getByText("Selected sandbox:")).toBeVisible();
  await expect(
    page.getByText("sbx_clone_alpha_111111", { exact: true }).last()
  ).toBeVisible();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(
    page.getByRole("menuitem", { name: "Open sandbox preview" })
  ).toHaveAttribute("title", "https://clone-a-preview.example.vercel.app");
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Chat", exact: true }).click();
  await page
    .getByPlaceholder("Ask for follow-up changes or attach images")
    .fill("Continue in the selected sandbox");
  await page.keyboard.press("Enter");
  await expect.poll(() => chatRequests.length).toBe(2);
  expect(chatRequests[1]?.sandboxId).toBe("rec-clone-a");

  // The Sandboxes tab shows remote compute with real status and actions.
  await page
    .getByRole("tab", {
      name: "Sandboxes, 5 current sandboxes, 2 previous attempts",
    })
    .click();
  await expect(page.getByRole("heading", { name: "Sandboxes" })).toBeVisible();
  await expect(
    page.getByText(
      "Remote compute for commands and previews. A sandbox can host zero or more worktree checkouts."
    )
  ).toBeVisible();
  const liveSandbox = page.getByRole("region", {
    name: "Sandbox sbx_live123",
  });
  await expect(liveSandbox.getByText("sbx_live123")).toBeVisible();
  await expect(liveSandbox.getByText("feat/demo from main")).toBeVisible();
  await expect(liveSandbox.getByText("Running", { exact: true })).toBeVisible();
  await expect(
    liveSandbox.getByText("No recent compute output.")
  ).toBeVisible();
  await expect(
    liveSandbox.getByRole("button", { name: "Preview" })
  ).toBeEnabled();
  await expect(
    liveSandbox.getByRole("button", { name: "Stop compute" })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();
  const historySummary = page.getByText("Previous attempts (2)", {
    exact: true,
  });
  await expect(historySummary).toBeVisible();
  await historySummary.click();
  await expect(page.getByText("Runtime failed to start")).toBeVisible();
  const stoppedSandbox = page.getByRole("region", {
    name: "Sandbox sbx_stopped",
  });
  await expect(
    stoppedSandbox.getByText("Unavailable", { exact: true })
  ).toBeVisible();
  await expect(
    stoppedSandbox.getByRole("button", { name: "Preview" })
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: "Merge to main" })).toHaveCount(
    0
  );

  // A paused sandbox can be resumed without creating a replacement, so its
  // persisted worktree binding remains valid.
  const pausedSandbox = page.getByRole("region", {
    name: "Sandbox sbx_paused",
  });
  await page.getByRole("button", { name: "Resume" }).click();
  await expect.poll(() => resumePosted).toBe(true);
  await expect(
    pausedSandbox.getByLabel("Runtime status: Running")
  ).toBeVisible();

  // The top-bar preview follows the selected sandbox, not the first running
  // sandbox returned by the collection endpoint.
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(
    page.getByRole("menuitem", { name: "Open sandbox preview" })
  ).toHaveAttribute("title", "https://paused-preview.example.vercel.app");
  await page.keyboard.press("Escape");

  // Preview opens the real sandbox URL in a modal and closes again.
  await liveSandbox.getByRole("button", { name: "Preview" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText("https://preview.example.vercel.app")
  ).toBeVisible();
  await expect(dialog.getByText("feat/demo")).toBeVisible();
  await dialog.getByRole("button", { name: "Close preview" }).click();
  await expect(dialog).toBeHidden();

  // Stop hits the real endpoint and the card reflects the new state.
  await liveSandbox.getByRole("button", { name: "Stop compute" }).click();
  const stopDialog = page.getByRole("alertdialog", {
    name: "Stop sandbox compute?",
  });
  await expect(
    stopDialog.getByText(
      "Compute, snapshots, sessions, and preview are removed. The sandbox record and worktree records stay for restart, but checkout data becomes unavailable. Mogplex does not delete remote Git branches."
    )
  ).toBeVisible();
  await stopDialog.getByRole("button", { name: "Stop compute" }).click();
  await expect.poll(() => stopPosted).toBe(true);
  await expect(liveSandbox.getByLabel("Runtime status: Stopped")).toBeVisible();
  await expect(
    liveSandbox.getByRole("button", { name: "Restart" })
  ).toBeVisible();

  // A stopped sandbox restarts through its existing record instead of
  // creating unrelated compute that would strand the worktree binding.
  await liveSandbox.getByRole("button", { name: "Restart" }).click();
  await expect.poll(() => restartPosted).toBe(true);
  await expect(liveSandbox.getByLabel("Runtime status: Running")).toBeVisible();

  // Delete is a separate, destructive lifecycle with explicit consequences.
  const failedSandbox = page.getByRole("region", {
    name: "Sandbox sbx_failed",
  });
  await failedSandbox.getByRole("button", { name: "Delete sandbox" }).click();
  const deleteDialog = page.getByRole("alertdialog", {
    name: "Delete sandbox record?",
  });
  await expect(
    deleteDialog.getByText(
      "Compute, snapshots, sessions, and the sandbox record are removed. Worktree records stay, but their checkouts become unavailable. Mogplex does not delete remote Git branches."
    )
  ).toBeVisible();
  await deleteDialog.getByRole("button", { name: "Delete sandbox" }).click();
  await expect.poll(() => deletePosted).toBe(true);
  await expect(failedSandbox).toHaveCount(0);

  // The dashed spawn card stays available.
  await expect(
    page.getByRole("button", { name: /Start sandbox/ }).first()
  ).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const narrowSelector = page.getByRole("button", {
    name: /Selected sandbox acme\/widgets, branch .*\. Choose sandbox for chat and preview/,
  });
  await expect(narrowSelector).toBeVisible();
  await narrowSelector.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("menuitem", { name: /for chat and preview/ })
  ).toHaveCount(5);
  await page.keyboard.press("Escape");
  await expect(
    page.getByText("Remote compute for commands and previews.")
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth)
  ).toBeLessThanOrEqual(390);
});
