import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  fulfillJson,
  mockBaseChrome,
} from "./helpers/automation-control-plane-fixtures";

const NOW = new Date().toISOString();
const WORKTREE_ID = "11111111-2222-4333-8444-555555555555";

test("Control counts worktrees separately from sandbox compute", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockBaseChrome(page);
  await page.route("**/api/connections", (route) =>
    fulfillJson(route, { connections: [] })
  );
  await page.route("**/api/repos", (route) =>
    fulfillJson(route, [
      {
        id: "repo-1",
        full_name: "Mogplex/mogplex",
        owner: "Mogplex",
        name: "mogplex",
        default_branch: "main",
      },
    ])
  );
  await page.route("**/api/control/sessions**", (route) => {
    const url = new URL(route.request().url());
    const session = {
      id: "session-1",
      title: "Separate worktrees",
      project: "Mogplex/mogplex",
      repo_id: "repo-1",
      orchestration_run_id: "run-1",
      pinned: false,
      archived: false,
      messages: [],
      created_at: NOW,
      updated_at: NOW,
    };
    return fulfillJson(route, url.searchParams.has("id") ? session : [session]);
  });
  await page.route("**/api/sandbox", (route) =>
    fulfillJson(route, { sandboxes: [] })
  );
  await page.route("**/api/control/worktrees**", (route) =>
    fulfillJson(route, {
      worktrees: [
        {
          id: WORKTREE_ID,
          user_id: "user-1",
          run_id: "run-1",
          task_id: "task-1",
          repo_id: "repo-1",
          sandbox_id: "sandbox-record-1",
          agent_id: null,
          branch_name: "mogplex/task/separate-worktrees/code",
          base_branch: "main",
          checkout_path: `/vercel/sandbox/.worktrees/${WORKTREE_ID}`,
          status: "active",
          latest_commit_sha: null,
          error: null,
          metadata: {},
          created_at: NOW,
          updated_at: NOW,
          archived_at: null,
          pruned_at: null,
        },
      ],
    })
  );

  await page.goto(`${scopedPath("control")}?mission=session-1`);
  await page.waitForLoadState("networkidle");

  await expect(page.getByRole("button", { name: "Worktrees 1" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sandboxes 0" })).toBeVisible();

  await page.getByRole("button", { name: "Worktrees 1" }).click();
  await expect(page.getByRole("heading", { name: "Worktrees" })).toBeVisible();
  await expect(
    page.getByText("mogplex/task/separate-worktrees/code")
  ).toBeVisible();
  await expect(
    page.getByText(`/vercel/sandbox/.worktrees/${WORKTREE_ID}`)
  ).toBeVisible();
  await expect(
    page.getByText(
      "Isolated Git checkouts assigned to mission tasks. Sandbox compute can stop or resume without changing this list."
    )
  ).toBeVisible();

  await page.getByRole("button", { name: "Sandboxes 0" }).click();
  await expect(page.getByRole("heading", { name: "Sandboxes" })).toBeVisible();
  await expect(page.getByText("No sandboxes yet")).toBeVisible();
});
