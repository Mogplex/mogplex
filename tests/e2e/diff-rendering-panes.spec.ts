import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  fulfillJson,
  mockBaseApp,
  modelId,
  repo,
} from "./helpers/diff-rendering-fixtures";

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
