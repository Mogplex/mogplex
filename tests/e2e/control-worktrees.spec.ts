import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import {
  fulfillJson,
  mockBaseChrome,
} from "./helpers/automation-control-plane-fixtures";

const NOW = new Date().toISOString();
const WORKTREE_ID = "11111111-2222-4333-8444-555555555555";

function worktreeRecord(input: {
  id: string;
  runId: string;
  taskId: string;
  branch: string;
  status?: "active" | "archived" | "pruned" | "error";
}) {
  return {
    id: input.id,
    user_id: "user-1",
    run_id: input.runId,
    task_id: input.taskId,
    repo_id: "repo-1",
    sandbox_id: "sandbox-record-1",
    agent_id: null,
    branch_name: input.branch,
    base_branch: "main",
    checkout_path: `/vercel/sandbox/.worktrees/${input.id}`,
    status: input.status ?? "active",
    latest_commit_sha: null,
    error: null,
    metadata: {},
    created_at: NOW,
    updated_at: NOW,
    archived_at: null,
    pruned_at: null,
  };
}

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
  let worktreeStatus: "active" | "archived" | "pruned" = "active";
  await page.route("**/api/control/worktrees**", (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { action?: string };
      if (body.action === "archive") worktreeStatus = "archived";
      if (body.action === "prune") worktreeStatus = "pruned";
      return fulfillJson(route, { worktree: {} });
    }
    return fulfillJson(route, {
      worktrees:
        worktreeStatus === "pruned"
          ? []
          : [
              worktreeRecord({
                id: WORKTREE_ID,
                runId: "run-1",
                taskId: "task-1",
                branch: "mogplex/task/separate-worktrees/code",
                status: worktreeStatus,
              }),
            ],
    });
  });

  await page.goto(`${scopedPath("control")}?mission=session-1`);
  await page.waitForLoadState("networkidle");

  await expect(
    page.getByRole("tab", { name: "Worktrees, 1 checkout" })
  ).toBeVisible();
  await expect(
    page.getByRole("tab", {
      name: "Sandboxes, 0 current sandboxes, 0 previous attempts",
    })
  ).toBeVisible();

  await page.getByRole("tab", { name: "Worktrees, 1 checkout" }).click();
  await expect(page.getByRole("heading", { name: "Worktrees" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
  await expect(
    page.getByText("mogplex/task/separate-worktrees/code")
  ).toBeVisible();
  await expect(
    page.getByText(`/vercel/sandbox/.worktrees/${WORKTREE_ID}`)
  ).toBeVisible();
  await expect(
    page.getByText(
      "Task-specific Git checkouts inside sandbox compute. Archiving or pruning a worktree does not stop its sandbox."
    )
  ).toBeVisible();
  await expect(page.getByText("Task task-1")).toBeVisible();
  await expect(page.getByText("Runs in sandbox")).toBeVisible();

  await page.getByRole("button", { name: "Archive worktree" }).click();
  const archiveDialog = page.getByRole("alertdialog", {
    name: "Archive this worktree?",
  });
  await expect(
    archiveDialog.getByText(
      "Archive marks the worktree inactive. Its Git checkout, branch, worktree record, and sandbox compute stay."
    )
  ).toBeVisible();
  await archiveDialog.getByRole("button", { name: "Archive worktree" }).click();
  await expect(page.getByText("Archived", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Prune checkout" }).click();
  const pruneDialog = page.getByRole("alertdialog", {
    name: "Prune this checkout?",
  });
  await expect(
    pruneDialog.getByText(
      "Prune removes the archived Git checkout and releases its task binding. The Git branch, pruned worktree record, and sandbox compute stay."
    )
  ).toBeVisible();
  await pruneDialog.getByRole("button", { name: "Prune checkout" }).click();
  await expect(page.getByText("No worktrees yet")).toBeVisible();

  await page
    .getByRole("tab", {
      name: "Sandboxes, 0 current sandboxes, 0 previous attempts",
    })
    .click();
  await expect(page.getByRole("heading", { name: "Sandboxes" })).toBeVisible();
  await expect(page.getByText("No current sandbox")).toBeVisible();
});

test("Control ignores a stale worktree response after switching sessions", async ({
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
  const sessions = [
    {
      id: "session-a",
      title: "Mission A",
      project: "Mogplex/mogplex",
      repo_id: "repo-1",
      orchestration_run_id: "run-a",
      pinned: false,
      archived: false,
      messages: [],
      created_at: NOW,
      updated_at: NOW,
    },
    {
      id: "session-b",
      title: "Mission B",
      project: "Mogplex/mogplex",
      repo_id: "repo-1",
      orchestration_run_id: "run-b",
      pinned: false,
      archived: false,
      messages: [],
      created_at: NOW,
      updated_at: NOW,
    },
  ];
  await page.route("**/api/control/sessions**", (route) => {
    const id = new URL(route.request().url()).searchParams.get("id");
    return fulfillJson(
      route,
      id ? sessions.find((session) => session.id === id) : sessions
    );
  });
  await page.route("**/api/sandbox", (route) =>
    fulfillJson(route, { sandboxes: [] })
  );

  let releaseMissionA = () => {};
  const missionABlocked = new Promise<void>((resolve) => {
    releaseMissionA = resolve;
  });
  let missionARequested = false;
  await page.route("**/api/control/worktrees**", async (route) => {
    const sessionId = new URL(route.request().url()).searchParams.get(
      "sessionId"
    );
    if (sessionId === "session-a") {
      missionARequested = true;
      await missionABlocked;
      return fulfillJson(route, {
        worktrees: [
          worktreeRecord({
            id: "11111111-2222-4333-8444-555555555551",
            runId: "run-a",
            taskId: "task-a",
            branch: "mogplex/task/mission-a",
          }),
        ],
      });
    }
    return fulfillJson(route, {
      worktrees: [
        worktreeRecord({
          id: "11111111-2222-4333-8444-555555555552",
          runId: "run-b",
          taskId: "task-b",
          branch: "mogplex/task/mission-b",
        }),
      ],
    });
  });

  await page.goto(scopedPath("control"));
  const sessionsRail = page.getByRole("complementary", { name: "Sessions" });
  await sessionsRail.getByRole("button", { name: /Mission A/ }).click();
  await expect.poll(() => missionARequested).toBe(true);
  await sessionsRail.getByRole("button", { name: /Mission B/ }).click();

  await expect(
    page.getByRole("tab", { name: "Worktrees, 1 checkout" })
  ).toBeVisible();
  await page.getByRole("tab", { name: "Worktrees, 1 checkout" }).click();
  await expect(page.getByText("mogplex/task/mission-b")).toBeVisible();

  const staleResponse = page.waitForResponse((response) =>
    response.url().includes("sessionId=session-a")
  );
  releaseMissionA();
  await staleResponse;

  await expect(page.getByText("mogplex/task/mission-b")).toBeVisible();
  await expect(page.getByText("mogplex/task/mission-a")).toHaveCount(0);
});

test("Control worktrees keeps teaching copy visible when loading fails", async ({
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
  const session = {
    id: "session-error",
    title: "Worktree error",
    project: "Mogplex/mogplex",
    repo_id: "repo-1",
    orchestration_run_id: "run-error",
    pinned: false,
    archived: false,
    messages: [],
    created_at: NOW,
    updated_at: NOW,
  };
  await page.route("**/api/control/sessions**", (route) =>
    fulfillJson(
      route,
      new URL(route.request().url()).searchParams.has("id")
        ? session
        : [session]
    )
  );
  await page.route("**/api/sandbox", (route) =>
    fulfillJson(route, { sandboxes: [] })
  );
  await page.route("**/api/control/worktrees**", (route) =>
    fulfillJson(route, { error: "Worktree service unavailable" }, 503)
  );

  await page.goto(`${scopedPath("control")}?mission=session-error`);
  await page.getByRole("tab", { name: "Worktrees, 0 checkouts" }).click();
  await expect(page.getByText("Worktree service unavailable")).toBeVisible();
  await expect(
    page.getByText(
      "Task-specific Git checkouts inside sandbox compute. Archiving or pruning a worktree does not stop its sandbox."
    )
  ).toBeVisible();
});
