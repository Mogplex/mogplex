import { expect, test } from "@playwright/test";
import { setupControlSidebar } from "./helpers/control-sidebar-fixture";
import { scopedPath } from "./helpers/auth";
import type { RunWorkspaceContext } from "@/lib/run-workspace/types";

test("Slack conversation opens its recorded run in Control and survives reload without launching work", async ({
  page,
}) => {
  const { sessions, sidebar } = await setupControlSidebar(page);
  const runId = "00000000-0000-4000-8000-000000000901";
  sessions[0].external_run_id = runId;
  sessions[0].title = "Mobile hero from Slack";
  sessions[0].updated_at = "2026-09-17T16:00:00.000Z";
  const context: RunWorkspaceContext = {
    runId,
    aiCallId: "call-1",
    prompt: "Fix the mobile hero",
    status: "failed",
    sandboxRecordId: "sandbox-1",
    workingBranch: "fix/hero",
    canGuide: false,
    repo: {
      id: "repo-1",
      user_id: "user-1",
      full_name: "acme/widgets",
      created_at: "2026-09-05T00:00:00Z",
      default_branch: "main",
      root_directory: null,
    },
  };
  await page.route("**/api/runs/*/workspace", (route) =>
    route.fulfill({ json: context })
  );
  await page.route("**/api/runs/*/stream?*", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: `event: run\ndata: ${JSON.stringify(context)}\n\nevent: log\ndata: ${JSON.stringify({ id: "e1", type: "log", message: "The mobile hero needs a smaller gutter.", payload: { kind: "assistant_delta" }, toolName: null, createdAt: "2026-09-05T00:00:00Z" })}\n\nevent: replay_complete\ndata: {}\n\n`,
    })
  );
  const mutations: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/api\/(?:control\/chat|sandbox(?:\/|$)|v1\/mogplex\/runs)/.test(
        new URL(request.url()).pathname
      )
    )
      mutations.push(request.url());
  });
  await page.reload();
  const conversation = page.getByTestId("control-external-run");
  await expect(
    conversation.getByRole("heading", { name: "Mobile hero from Slack" })
  ).toBeVisible();
  await expect(conversation).toContainText(
    "The mobile hero needs a smaller gutter."
  );
  await expect(
    conversation.getByText("Run failed", { exact: true })
  ).toBeVisible();
  await expect(
    conversation.getByRole("link", { name: "Continue in workspace chat" })
  ).toHaveAttribute("href", scopedPath(`projects/workspace?run=${runId}`));
  await sidebar.getByRole("button", { name: /^Fix 6 / }).click();
  await expect(conversation).toHaveCount(0);
  await sidebar
    .getByRole("button", { name: /^Mobile hero from Slack / })
    .click();
  await expect(conversation).toContainText(
    "The mobile hero needs a smaller gutter."
  );
  await page.reload();
  await expect(conversation).toContainText(
    "The mobile hero needs a smaller gutter."
  );
  expect(mutations).toEqual([]);
});

test("an accepted Slack session appears in an already open Control sidebar", async ({
  page,
}) => {
  const { sessions, sidebar } = await setupControlSidebar(page);
  let publish!: () => void;
  // Deliver the insert only after the first list has rendered. A reload or
  // selected-conversation refresh cannot satisfy this sidebar assertion.
  const accepted = new Promise<void>((resolve) => {
    publish = resolve;
  });
  await page.route("**/api/realtime/events?*", async (route) => {
    if (
      new URL(route.request().url()).searchParams.get("tables") !==
      "control_sessions"
    )
      return route.fulfill({ status: 204 });
    await accepted;
    await route.fulfill({
      contentType: "text/event-stream",
      body: 'data: {"table":"control_sessions","op":"INSERT"}\n\n',
    });
  });
  try {
    await page.reload();
    await expect(
      sidebar.getByRole("button", { name: /^Fix 6 / })
    ).toBeVisible();
    sessions.push({
      ...sessions[0],
      id: "slack-new",
      title: "New Slack request",
      external_run_id: "00000000-0000-4000-8000-000000000902",
      updated_at: "2026-09-17T16:00:00.000Z",
    });
    publish();
    await expect(
      sidebar.getByRole("button", { name: /^New Slack request / })
    ).toBeVisible();
  } finally {
    publish();
  }
});
