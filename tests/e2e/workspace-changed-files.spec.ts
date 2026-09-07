import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  initializeTrackedEvents,
  mockActivationFlow,
} from "./helpers/activation-fixtures";

type ChangesPayload = {
  branch: string;
  baseBranch: string;
  ahead: number;
  behind: number;
  files: Array<{
    path: string;
    status: string;
    additions: number;
    deletions: number;
  }>;
};

const DIRTY: ChangesPayload = {
  branch: "mogplex/agent-e2e",
  baseBranch: "main",
  ahead: 0,
  behind: 0,
  files: [
    { path: "src/app.ts", status: "modified", additions: 3, deletions: 1 },
    { path: "docs/new.md", status: "untracked", additions: 7, deletions: 0 },
  ],
};

test("the agent pane lists sandbox changes with diff, revert, and commit actions", async ({
  page,
}) => {
  await initializeTrackedEvents(page);
  await enableScopedE2EAuth(page);
  await mockActivationFlow(page);
  let changes: ChangesPayload = DIRTY;
  let delayedStatus: Promise<void> | null = null;
  const posts: Array<Record<string, unknown>> = [];
  await page.route(
    /\/api\/sandbox\/[^/]+\/changes(?:\?.*)?$/,
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
        if (delayedStatus) await delayedStatus;
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
          pullRequestUrl: "https://github.com/acme/demo-app/pull/7",
          changes,
        },
      });
    }
  );

  await page.goto(scopedPath("projects/workspace"));
  await page.waitForLoadState("networkidle");
  await page.getByTestId("home-sync-repos").click();
  await page.getByTestId("home-open-workspace-repo-1").click();
  await expect(page.getByTestId("preview-grab-button")).toBeEnabled();

  const bar = page.getByTestId("changed-files-bar");
  await expect(bar).toContainText("2 files changed");
  await expect(bar).toContainText("mogplex/agent-e2e");

  await page.getByTestId("changed-files-toggle").click();
  await expect(page.getByTestId("changed-file-src/app.ts")).toBeVisible();
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
  const message = page.getByTestId("changed-files-commit-message");
  await message.fill("Rename the constant");
  let releaseStatus!: () => void;
  delayedStatus = new Promise<void>((resolve) => {
    releaseStatus = resolve;
  });
  const refreshRequest = page.waitForRequest(
    (request) =>
      request.method() === "GET" && request.url().endsWith("/changes")
  );
  await page.getByRole("button", { name: "Refresh changes" }).click();
  await refreshRequest;
  try {
    await expect(page.getByTestId("changed-files-revert-all")).toBeDisabled();
    await expect(page.getByTestId("changed-files-commit-pr")).toBeDisabled();
  } finally {
    releaseStatus();
    delayedStatus = null;
  }
  await expect(page.getByTestId("changed-files-commit-pr")).toBeEnabled();
  await page.getByTestId("changed-files-commit-pr").click();
  await expect(page.getByTestId("changed-files-delivery")).toContainText(
    "Pushed mogplex/agent-e2e"
  );
  await expect(
    page.getByRole("link", { name: "Open pull request" })
  ).toHaveAttribute("href", "https://github.com/acme/demo-app/pull/7");
  expect(posts[1]).toEqual({
    action: "commit",
    message: "Rename the constant",
    push: true,
    openPullRequest: true,
  });
});

test("clean ahead branches retain push recovery after a failed delivery and remount", async ({
  page,
}) => {
  await initializeTrackedEvents(page);
  await enableScopedE2EAuth(page);
  await mockActivationFlow(page);
  let changes: ChangesPayload = DIRTY;
  let failPush = true;
  await page.route(/\/api\/sandbox\/[^/]+\/changes$/, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: changes });
      return;
    }
    changes = { ...DIRTY, files: [], ahead: 1 };
    if (failPush) {
      failPush = false;
      await route.fulfill({ status: 500, json: { error: "Push failed" } });
    } else {
      changes = { ...changes, ahead: 0 };
      await route.fulfill({
        json: { committed: false, pushed: true, sha: "abc123", changes },
      });
    }
  });
  const openWorkspace = async () => {
    await page.goto(scopedPath("projects/workspace"));
    await page.getByTestId("home-sync-repos").click();
    await page.getByTestId("home-open-workspace-repo-1").click();
  };
  await openWorkspace();
  await page.getByTestId("changed-files-commit").click();
  await page
    .getByTestId("changed-files-commit-message")
    .fill("Commit before push fails");
  await page.getByTestId("changed-files-commit-push").click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Push failed" })
  ).toBeVisible();
  // Re-entering the workspace reconstructs state from Git, without a local
  // delivery result or the old error keeping the panel visible.
  await page.reload();
  await expect(page.getByTestId("changed-files-bar")).toContainText(
    "0 files changed"
  );
  await expect(page.getByTestId("changed-files-commit")).toHaveText("Push");
  await page.getByTestId("changed-files-commit").click();
  await expect(page.getByTestId("changed-files-commit-push")).toBeEnabled();
  await page.getByTestId("changed-files-commit-push").click();
  await expect(page.getByTestId("changed-files-delivery")).toContainText(
    "Pushed"
  );
});
