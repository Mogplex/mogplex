import { expect, test } from "@playwright/test";
import { setupControlSidebar } from "./helpers/control-sidebar-fixture";
import { scopedPath } from "./helpers/auth";
import type {
  RunWorkspaceContext,
  RunWorkspaceEvent,
} from "@/lib/run-workspace/types";

for (const withGuidance of [false, true]) {
  test(`Slack conversation ${withGuidance ? "with recorded guidance" : "without guidance"} opens its recorded run in Control and survives reload without launching work`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
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
      guidance: withGuidance
        ? [
            { id: "g1", body: "Keep the desktop layout", status: "delivered" },
            { id: "g2", body: "Check the mobile CTA", status: "not_applied" },
          ]
        : [],
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
    const events: RunWorkspaceEvent[] = [
      {
        id: "e1",
        type: "log",
        message: "The mobile hero needs a smaller gutter.",
        payload: { kind: "assistant_delta" },
        toolName: null,
        createdAt: "2026-09-05T00:00:00Z",
      },
      {
        id: "e2",
        type: "tool_started",
        message: null,
        payload: { toolCallId: "read-1", input: { path: "app/page.tsx" } },
        toolName: "read_file",
        createdAt: "2026-09-05T00:00:01Z",
      },
      {
        id: "e3",
        type: "tool_finished",
        message: null,
        payload: {
          toolCallId: "read-1",
          state: "done",
          output: "Hero source loaded",
        },
        toolName: "read_file",
        createdAt: "2026-09-05T00:00:02Z",
      },
    ];
    await page.route("**/api/runs/*/stream?*", (route) =>
      route.fulfill({
        contentType: "text/event-stream",
        body: `event: run\ndata: ${JSON.stringify(context)}\n\n${events.map((event) => `event: log\ndata: ${JSON.stringify(event)}\n\n`).join("")}event: replay_complete\ndata: {}\n\n`,
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
    const transcript = conversation.getByRole("log", { name: "Conversation" });
    await expect(transcript).toBeVisible();
    await expect(transcript).toContainText("Fix the mobile hero");
    await expect(
      conversation.getByRole("button", { name: /Earlier conversation/ })
    ).toHaveCount(0);
    if (withGuidance) {
      await expect(transcript).toContainText("Keep the desktop layout");
      await expect(transcript).toContainText("Delivered to agent");
      await expect(transcript).toContainText("Check the mobile CTA");
      await expect(transcript).toContainText(
        "Not applied before the run stopped"
      );
    }
    await expect(
      transcript.getByText("YOU", { exact: true }).first()
    ).toBeVisible();
    await expect(
      transcript.getByText("MOGPLEX", { exact: true })
    ).toBeVisible();
    const activity = transcript.getByTestId("tool-activity");
    await expect(activity).toContainText("Reading file");
    await expect(activity).toContainText("Complete");
    await activity.locator("summary").click();
    await expect(activity.locator("pre")).toHaveText("app/page.tsx");
    const response = transcript.getByText(
      "The mobile hero needs a smaller gutter.",
      { exact: true }
    );
    await expect(response).toHaveCSS("font-size", "14px");
    const transcriptContent = transcript.locator(":scope > div").first();
    expect((await transcriptContent.boundingBox())?.width).toBeLessThanOrEqual(
      1024
    );
    await conversation.screenshot({
      path: testInfo.outputPath("control-external-chat.png"),
    });
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
    await expect(transcript).toContainText("Fix the mobile hero");
    await expect(transcript.getByTestId("tool-activity")).toContainText(
      "Reading file"
    );
    if (withGuidance)
      await expect(transcript).toContainText("Check the mobile CTA");
    expect(mutations).toEqual([]);
  });
}

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

test("sending live guidance keeps the prompt and agent response visible", async ({
  page,
}) => {
  const { sessions } = await setupControlSidebar(page);
  const runId = "00000000-0000-4000-8000-000000000903";
  sessions[0].external_run_id = runId;
  const context: RunWorkspaceContext = {
    runId,
    aiCallId: "call-live",
    prompt: "Fix the mobile hero",
    status: "streaming",
    sandboxRecordId: "sandbox-1",
    workingBranch: "fix/hero",
    canGuide: true,
    guidance: [],
    repo: {
      id: "repo-1",
      user_id: "user-1",
      full_name: "acme/widgets",
      created_at: "2026-09-05T00:00:00Z",
    },
  };
  await page.route("**/api/runs/*/workspace", (route) =>
    route.fulfill({ json: context })
  );
  const event: RunWorkspaceEvent = {
    id: "live-1",
    type: "log",
    message: "I am checking the mobile hero.",
    payload: { kind: "assistant_delta" },
    toolName: null,
    createdAt: "2026-09-05T00:00:00Z",
  };
  await page.route("**/api/runs/*/stream?*", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: `event: run\ndata: ${JSON.stringify(context)}\n\nevent: log\ndata: ${JSON.stringify(event)}\n\nevent: replay_complete\ndata: {}\n\n`,
    })
  );
  await page.route("**/api/runs/*/guidance", async (route) => {
    const submission = route.request().postDataJSON() as {
      id: string;
      text: string;
    };
    context.guidance = [
      { id: submission.id, body: submission.text, status: "received" },
    ];
    await route.fulfill({ json: { status: "received" } });
  });
  await page.reload();
  const conversation = page.getByTestId("control-external-run");
  const transcript = conversation.getByRole("log", { name: "Conversation" });
  await expect(transcript).toContainText("I am checking the mobile hero.");
  await conversation
    .getByRole("textbox", { name: "Guide this run" })
    .fill("Keep the CTA visible");
  await conversation
    .getByRole("button", { name: "Send guidance", exact: true })
    .click();
  await expect(transcript).toContainText("Keep the CTA visible");
  await expect(transcript).toContainText("Saved for the next agent step");
  await expect(transcript).toContainText("Fix the mobile hero");
  await expect(transcript).toContainText("I am checking the mobile hero.");
  await expect(
    conversation.getByRole("button", { name: /Earlier conversation/ })
  ).toHaveCount(0);
});
