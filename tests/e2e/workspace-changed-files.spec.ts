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
